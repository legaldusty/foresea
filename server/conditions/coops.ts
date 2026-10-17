import { NOAA_DATA_API, noaaDate, parseNoaaTime } from '../noaa/client';
import { finiteNumber, freshEnough, getJson, type FetchContext } from './http';
import type { TideTrend } from '../../src/shared/protocol';

const APPLICATION = 'giveway';

export interface StationValue { station: string; stationName: string; value: number; at: string }

export interface WindSample { at: string; speedMps: number; gustMps: number | null }

export interface WindValue { station: string; stationName: string; speedMps: number; gustMps: number | null; fromDeg: number | null; at: string; history?: WindSample[] }

export interface LevelSample { at: number; meters: number }

export interface TideTurn { kind: 'high' | 'low'; at: string; meters: number }

export interface TidePoint { at: string; meters: number }

export interface TideReading {
  station: string;
  stationName: string;
  datum: string;
  level: { meters: number; at: string } | null;
  trend: TideTrend | null;
  turns: TideTurn[];
  curve?: TidePoint[];
  measured?: TidePoint[];
}

interface CoopsBody {
  metadata?: { id?: string; name?: string };
  data?: Record<string, string | number | undefined>[];
  predictions?: { t?: string; v?: string | number; type?: string }[];
  error?: { message?: string };
}

export function coopsUrl(params: Record<string, string>): string {
  return `${NOAA_DATA_API}?${new URLSearchParams({ application: APPLICATION, format: 'json', time_zone: 'gmt', units: 'metric', ...params }).toString()}`;
}

function coopsBody(body: unknown, station: string): CoopsBody {
  const b = (body ?? {}) as CoopsBody;
  if (b.error) throw new Error(`station ${station}: ${b.error.message?.split('.')[0] ?? 'no data'}`);
  return b;
}

function isoTime(t: string | undefined): string | null {
  if (!t) return null;
  const ms = parseNoaaTime(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseLatestValue(body: unknown, station: string): StationValue | null {
  const b = coopsBody(body, station);
  const row = b.data?.[b.data.length - 1];
  const at = isoTime(row?.t as string | undefined);
  const value = finiteNumber(row?.v);
  if (!at || value === null) return null;
  return { station, stationName: b.metadata?.name ?? station, value, at };
}

export function parseWind(body: unknown, station: string): WindValue | null {
  const b = coopsBody(body, station);
  const history: WindSample[] = [];
  let latest: WindValue | null = null;
  for (const row of b.data ?? []) {
    const at = isoTime(row.t as string | undefined);
    const speedMps = finiteNumber(row.s);
    if (!at || speedMps === null) continue;
    const gustMps = finiteNumber(row.g);
    history.push({ at, speedMps, gustMps });
    latest = { station, stationName: b.metadata?.name ?? station, speedMps, gustMps, fromDeg: finiteNumber(row.d), at };
  }
  return latest && history.length > 1 ? { ...latest, history } : latest;
}

export function parseLevelSeries(body: unknown, station: string): { stationName: string; samples: LevelSample[] } {
  const b = coopsBody(body, station);
  const samples: LevelSample[] = [];
  for (const row of b.data ?? []) {
    const at = row.t ? parseNoaaTime(String(row.t)) : NaN;
    const meters = finiteNumber(row.v);
    if (Number.isFinite(at) && meters !== null) samples.push({ at, meters });
  }
  return { stationName: b.metadata?.name ?? station, samples: samples.sort((a, c) => a.at - c.at) };
}

export function levelTrend(samples: LevelSample[], windowMinutes: number, steadyMeters: number): TideTrend | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const start = last.at - windowMinutes * 60_000;
  const first = samples.find((s) => s.at >= start) ?? samples[0];
  if (first === last) return null;
  const change = last.meters - first.meters;
  return Math.abs(change) < steadyMeters ? 'steady' : change > 0 ? 'rising' : 'falling';
}

export function parseTideTurns(body: unknown, station: string): TideTurn[] {
  const b = coopsBody(body, station);
  const turns: TideTurn[] = [];
  for (const row of b.predictions ?? []) {
    const at = isoTime(row.t);
    const meters = finiteNumber(row.v);
    if (!at || meters === null || (row.type !== 'H' && row.type !== 'L')) continue;
    turns.push({ kind: row.type === 'H' ? 'high' : 'low', at, meters });
  }
  return turns.sort((a, c) => Date.parse(a.at) - Date.parse(c.at));
}

export function parsePredictionCurve(body: unknown, station: string): TidePoint[] {
  const b = coopsBody(body, station);
  const points: TidePoint[] = [];
  for (const row of b.predictions ?? []) {
    const at = isoTime(row.t);
    const meters = finiteNumber(row.v);
    if (at && meters !== null && !row.type) points.push({ at, meters });
  }
  return points.sort((a, c) => Date.parse(a.at) - Date.parse(c.at));
}

export function nextTurns(turns: TideTurn[], now: number): { high: TideTurn | null; low: TideTurn | null } {
  const ahead = turns.filter((t) => Date.parse(t.at) > now);
  return { high: ahead.find((t) => t.kind === 'high') ?? null, low: ahead.find((t) => t.kind === 'low') ?? null };
}

export interface TideFetchOptions {
  datum: string;
  trendMinutes: number;
  steadyMeters: number;
  predictionHours: number;
  curve: { pastHours: number; aheadHours: number; intervalMinutes: number };
}

export async function fetchTide(ctx: FetchContext, station: string, o: TideFetchOptions): Promise<TideReading> {
  const hour = 3_600_000;
  const levelHours = Math.max(1, Math.ceil(o.trendMinutes / 60), o.curve.pastHours);
  const levelUrl = coopsUrl({ product: 'water_level', station, datum: o.datum, range: String(levelHours) });
  const turnUrl = coopsUrl({ product: 'predictions', station, datum: o.datum, interval: 'hilo', begin_date: noaaDate(ctx.now - o.curve.pastHours * hour), range: String(o.predictionHours + o.curve.pastHours) });
  const curveUrl = coopsUrl({ product: 'predictions', station, datum: o.datum, interval: String(o.curve.intervalMinutes), begin_date: noaaDate(ctx.now - o.curve.pastHours * hour), range: String(o.curve.pastHours + o.curve.aheadHours) });
  const [levelResult, turnResult, curveResult] = await Promise.allSettled([getJson(ctx, levelUrl), getJson(ctx, turnUrl), getJson(ctx, curveUrl)]);
  if (levelResult.status === 'rejected' && turnResult.status === 'rejected') throw new Error((levelResult.reason as Error).message);
  const series = levelResult.status === 'fulfilled' ? parseLevelSeries(levelResult.value, station) : { stationName: station, samples: [] };
  const turns = turnResult.status === 'fulfilled' ? parseTideTurns(turnResult.value, station) : [];
  const curve = curveResult.status === 'fulfilled' ? parsePredictionCurve(curveResult.value, station) : [];
  const last = series.samples[series.samples.length - 1];
  return {
    station,
    stationName: series.stationName,
    datum: o.datum,
    level: last ? { meters: last.meters, at: new Date(last.at).toISOString() } : null,
    trend: levelTrend(series.samples, o.trendMinutes, o.steadyMeters),
    turns,
    curve,
    measured: series.samples.map((x) => ({ at: new Date(x.at).toISOString(), meters: x.meters })),
  };
}

async function firstFresh<T extends { at: string }>(ctx: FetchContext, stations: string[], product: string, maxAgeMinutes: number, parse: (body: unknown, station: string) => T | null, span: Record<string, string> = { date: 'latest' }): Promise<T> {
  const reasons: string[] = [];
  for (const station of stations) {
    try {
      const found = parse(await getJson(ctx, coopsUrl({ product, station, ...span })), station);
      if (found && freshEnough(found.at, ctx.now, maxAgeMinutes)) return found;
      reasons.push(found ? `station ${station}: newest reading is older than ${maxAgeMinutes} min` : `station ${station}: no reading`);
    } catch (err) {
      reasons.push((err as Error).message.startsWith('station') ? (err as Error).message : `station ${station} ${(err as Error).message}`);
    }
  }
  throw new Error(reasons.join('; ') || 'no station configured');
}

export function fetchWind(ctx: FetchContext, stations: string[], maxAgeMinutes: number, historyHours: number): Promise<WindValue> {
  return firstFresh(ctx, stations, 'wind', maxAgeMinutes, parseWind, { range: String(Math.max(1, historyHours)) });
}

export function fetchStationValue(ctx: FetchContext, stations: string[], product: 'air_temperature' | 'air_pressure', maxAgeMinutes: number): Promise<StationValue> {
  return firstFresh(ctx, stations, product, maxAgeMinutes, parseLatestValue);
}
