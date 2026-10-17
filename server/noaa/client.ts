import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import giveWaySettings from '../../settings/giveway.settings.json';

export const NOAA_DATA_API = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
export const NOAA_STATIONS_API = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations';
export const CACHE_FILE = fileURLToPath(new URL('../../data/cache/noaa.json', import.meta.url));
export const SNAPSHOT_FILE = fileURLToPath(new URL('../../src/data/noaa-snapshot.json', import.meta.url));
const APPLICATION = 'giveway';
const CM_PER_M = 100;
const RAD = Math.PI / 180;
const WATER_LEVEL_DATUM = 'MLLW';

export type NoaaSource = 'live' | 'cache' | 'snapshot';
export type CurrentBasis = 'observed' | 'predicted';

export interface NoaaSettings {
  map: { bbox: number[] };
  noaa: {
    waterLevelStation: string;
    currentStations: string[];
    cacheMinutes: number;
    observedMaxAgeMinutes: number;
    predictionHours: number;
    predictionIntervalMinutes: number;
    stationSearchPadDeg: number;
    requestTimeoutSeconds: number;
  };
}

export interface CurrentSample {
  at: string;
  speedMps: number;
  towardDeg: number;
}

export interface CurrentSeries {
  station: string;
  stationName: string;
  basis: CurrentBasis;
  depthM: number | null;
  samples: CurrentSample[];
}

export interface WaterLevelSample {
  station: string;
  stationName: string;
  meters: number;
  datum: string;
  observedAt: string;
}

export interface NoaaPayload {
  fetchedAt: string;
  current: CurrentSeries | null;
  waterLevel: WaterLevelSample | null;
}

export interface CurrentReading {
  speedMps: number;
  towardDeg: number;
  u: number;
  v: number;
  station: string;
  stationName: string;
  observedAt: string;
  basis: CurrentBasis;
  source: NoaaSource;
  fetchedAt: string;
}

export interface WaterLevelReading extends WaterLevelSample {
  source: NoaaSource;
  fetchedAt: string;
}

export interface StationCandidate {
  id: string;
  name: string;
  lat: number;
  lon: number;
  listedAs: string[];
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function currentVector(speedMps: number, towardDeg: number): { u: number; v: number } {
  return { u: speedMps * Math.sin(towardDeg * RAD), v: speedMps * Math.cos(towardDeg * RAD) };
}

export function vectorToSpeedToward(u: number, v: number): { speedMps: number; towardDeg: number } {
  const speedMps = Math.hypot(u, v);
  const towardDeg = speedMps === 0 ? 0 : (Math.atan2(u, v) / RAD + 360) % 360;
  return { speedMps, towardDeg };
}

export function parseNoaaTime(value: string): number {
  return Date.parse(`${value.trim().replace(' ', 'T')}:00Z`);
}

export function noaaDate(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams({ application: APPLICATION, format: 'json', time_zone: 'gmt', units: 'metric', ...params }).toString();
}

async function fetchJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`NOAA answered ${response.status}`);
  return response.json();
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
}

interface ObservedResponse {
  metadata?: { id?: string; name?: string };
  data?: { t?: string; s?: string | number; d?: string | number }[];
  error?: { message?: string };
}

interface PredictionResponse {
  current_predictions?: {
    cp?: {
      Time?: string;
      Speed?: string | number;
      Direction?: string | number;
      Velocity_Major?: string | number;
      meanFloodDir?: string | number;
      meanEbbDir?: string | number;
      Depth?: string | number;
    }[];
  };
  error?: { message?: string };
}

interface WaterLevelResponse {
  metadata?: { id?: string; name?: string };
  data?: { t?: string; v?: string | number }[];
  error?: { message?: string };
}

export async function fetchStationName(fetchImpl: FetchLike, station: string, timeoutMs: number): Promise<string> {
  try {
    const body = (await fetchJson(fetchImpl, `${NOAA_STATIONS_API}/${encodeURIComponent(station)}.json`, timeoutMs)) as { stations?: { name?: string }[] };
    return body.stations?.[0]?.name ?? station;
  } catch {
    return station;
  }
}

export async function fetchObservedCurrent(fetchImpl: FetchLike, station: string, settings: NoaaSettings, now: number): Promise<CurrentSeries | null> {
  const timeoutMs = settings.noaa.requestTimeoutSeconds * 1000;
  const body = (await fetchJson(fetchImpl, `${NOAA_DATA_API}?${query({ product: 'currents', station, date: 'latest' })}`, timeoutMs)) as ObservedResponse;
  const latest = body.data?.[body.data.length - 1];
  if (!latest?.t) return null;
  const at = parseNoaaTime(latest.t);
  const speedCm = asNumber(latest.s);
  const toward = asNumber(latest.d);
  if (!Number.isFinite(at) || !Number.isFinite(speedCm) || !Number.isFinite(toward)) return null;
  if (now - at > settings.noaa.observedMaxAgeMinutes * 60_000) return null;
  return {
    station,
    stationName: body.metadata?.name ?? station,
    basis: 'observed',
    depthM: null,
    samples: [{ at: new Date(at).toISOString(), speedMps: speedCm / CM_PER_M, towardDeg: toward }],
  };
}

export function predictionSample(row: NonNullable<NonNullable<PredictionResponse['current_predictions']>['cp']>[number]): CurrentSample | null {
  if (!row.Time) return null;
  const at = parseNoaaTime(row.Time);
  if (!Number.isFinite(at)) return null;
  if (row.Speed !== undefined && row.Direction !== undefined) {
    const speedCm = asNumber(row.Speed);
    const toward = asNumber(row.Direction);
    if (!Number.isFinite(speedCm) || !Number.isFinite(toward)) return null;
    return { at: new Date(at).toISOString(), speedMps: speedCm / CM_PER_M, towardDeg: toward };
  }
  const major = asNumber(row.Velocity_Major);
  const flood = asNumber(row.meanFloodDir);
  const ebb = asNumber(row.meanEbbDir);
  if (!Number.isFinite(major) || !Number.isFinite(flood) || !Number.isFinite(ebb)) return null;
  return { at: new Date(at).toISOString(), speedMps: Math.abs(major) / CM_PER_M, towardDeg: major >= 0 ? flood : ebb };
}

export async function fetchPredictedCurrent(fetchImpl: FetchLike, station: string, settings: NoaaSettings, now: number): Promise<CurrentSeries | null> {
  const timeoutMs = settings.noaa.requestTimeoutSeconds * 1000;
  const interval = settings.noaa.predictionIntervalMinutes;
  const params = {
    product: 'currents_predictions',
    station,
    begin_date: noaaDate(now - interval * 60_000),
    end_date: noaaDate(now + settings.noaa.predictionHours * 3_600_000),
    interval: String(interval),
    vel_type: 'speed_dir',
  };
  const body = (await fetchJson(fetchImpl, `${NOAA_DATA_API}?${query(params)}`, timeoutMs)) as PredictionResponse;
  const rows = body.current_predictions?.cp ?? [];
  const samples = rows.map(predictionSample).filter((sample): sample is CurrentSample => sample !== null);
  if (samples.length === 0) return null;
  const depth = asNumber(rows[0]?.Depth);
  return {
    station,
    stationName: await fetchStationName(fetchImpl, station, timeoutMs),
    basis: 'predicted',
    depthM: Number.isFinite(depth) ? depth : null,
    samples,
  };
}

export async function fetchWaterLevel(fetchImpl: FetchLike, settings: NoaaSettings): Promise<WaterLevelSample | null> {
  const station = settings.noaa.waterLevelStation;
  const params = { product: 'water_level', station, date: 'latest', datum: WATER_LEVEL_DATUM };
  const body = (await fetchJson(fetchImpl, `${NOAA_DATA_API}?${query(params)}`, settings.noaa.requestTimeoutSeconds * 1000)) as WaterLevelResponse;
  const latest = body.data?.[body.data.length - 1];
  if (!latest?.t) return null;
  const meters = asNumber(latest.v);
  const at = parseNoaaTime(latest.t);
  if (!Number.isFinite(meters) || !Number.isFinite(at)) return null;
  return { station, stationName: body.metadata?.name ?? station, meters, datum: WATER_LEVEL_DATUM, observedAt: new Date(at).toISOString() };
}

export async function fetchCurrentSeries(fetchImpl: FetchLike, settings: NoaaSettings, now: number): Promise<CurrentSeries | null> {
  for (const station of settings.noaa.currentStations) {
    try {
      const observed = await fetchObservedCurrent(fetchImpl, station, settings, now);
      if (observed) return observed;
    } catch {
      continue;
    }
  }
  for (const station of settings.noaa.currentStations) {
    try {
      const predicted = await fetchPredictedCurrent(fetchImpl, station, settings, now);
      if (predicted) return predicted;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchNoaaPayload(fetchImpl: FetchLike, settings: NoaaSettings, now: number): Promise<NoaaPayload> {
  const [current, waterLevel] = await Promise.all([
    fetchCurrentSeries(fetchImpl, settings, now),
    fetchWaterLevel(fetchImpl, settings).catch(() => null),
  ]);
  return { fetchedAt: new Date(now).toISOString(), current, waterLevel };
}

export async function discoverCurrentStations(fetchImpl: FetchLike, settings: NoaaSettings): Promise<StationCandidate[]> {
  const [west, south, east, north] = settings.map.bbox;
  const pad = settings.noaa.stationSearchPadDeg;
  const found = new Map<string, StationCandidate>();
  for (const type of ['currents', 'currentpredictions']) {
    const body = (await fetchJson(fetchImpl, `${NOAA_STATIONS_API}.json?type=${type}`, settings.noaa.requestTimeoutSeconds * 1000)) as {
      stations?: { id?: string; name?: string; lat?: number; lng?: number }[];
    };
    for (const station of body.stations ?? []) {
      if (!station.id || typeof station.lat !== 'number' || typeof station.lng !== 'number') continue;
      if (station.lng < west - pad || station.lng > east + pad || station.lat < south - pad || station.lat > north + pad) continue;
      const entry = found.get(station.id) ?? { id: station.id, name: station.name ?? station.id, lat: station.lat, lon: station.lng, listedAs: [] };
      if (!entry.listedAs.includes(type)) entry.listedAs.push(type);
      found.set(station.id, entry);
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function currentAt(series: CurrentSeries, now: number): CurrentSample {
  const samples = series.samples;
  if (samples.length === 1 || series.basis === 'observed') return samples[samples.length - 1];
  const times = samples.map((sample) => Date.parse(sample.at));
  if (now <= times[0]) return samples[0];
  if (now >= times[times.length - 1]) return samples[samples.length - 1];
  let i = 0;
  while (times[i + 1] < now) i++;
  const before = samples[i];
  const after = samples[i + 1];
  const f = (now - times[i]) / (times[i + 1] - times[i]);
  const a = currentVector(before.speedMps, before.towardDeg);
  const b = currentVector(after.speedMps, after.towardDeg);
  const blended = vectorToSpeedToward(a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f);
  return { at: new Date(now).toISOString(), ...blended };
}

export function readPayload(file: string): NoaaPayload | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as NoaaPayload;
    return parsed && typeof parsed.fetchedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function writePayload(file: string, payload: NoaaPayload): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function writePayloadQuietly(file: string, payload: NoaaPayload): boolean {
  try {
    writePayload(file, payload);
    return true;
  } catch {
    return false;
  }
}

export interface NoaaClientOptions {
  settings?: NoaaSettings;
  fetch?: FetchLike;
  cacheFile?: string;
  snapshotFile?: string;
  now?: () => number;
}

export interface NoaaClient {
  getCurrent(): Promise<CurrentReading | null>;
  getWaterLevel(): Promise<WaterLevelReading | null>;
  refresh(): Promise<{ payload: NoaaPayload; source: NoaaSource } | null>;
}

export function createNoaaClient(options: NoaaClientOptions = {}): NoaaClient {
  const settings = options.settings ?? (giveWaySettings as NoaaSettings);
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const cacheFile = options.cacheFile ?? CACHE_FILE;
  const snapshotFile = options.snapshotFile ?? SNAPSHOT_FILE;
  const now = options.now ?? Date.now;
  const cacheMs = () => settings.noaa.cacheMinutes * 60_000;
  let memo: { payload: NoaaPayload; source: NoaaSource; loadedAt: number } | null = null;
  let inflight: Promise<{ payload: NoaaPayload; source: NoaaSource } | null> | null = null;

  const isFresh = (payload: NoaaPayload) => now() - Date.parse(payload.fetchedAt) < cacheMs();
  const hasData = (payload: NoaaPayload | null): payload is NoaaPayload => !!payload && (!!payload.current || !!payload.waterLevel);

  async function fetchLive(): Promise<{ payload: NoaaPayload; source: NoaaSource } | null> {
    try {
      const payload = await fetchNoaaPayload(fetchImpl, settings, now());
      if (!hasData(payload)) return null;
      writePayloadQuietly(cacheFile, payload);
      return { payload, source: 'live' };
    } catch {
      return null;
    }
  }

  async function load(force: boolean): Promise<{ payload: NoaaPayload; source: NoaaSource } | null> {
    if (!force && memo && now() - memo.loadedAt < cacheMs()) return memo;
    const cached = readPayload(cacheFile);
    if (!force && hasData(cached) && isFresh(cached)) {
      memo = { payload: cached, source: 'cache', loadedAt: now() };
      return memo;
    }
    const live = await fetchLive();
    if (live) {
      memo = { ...live, loadedAt: now() };
      return memo;
    }
    if (hasData(cached)) {
      memo = { payload: cached, source: 'cache', loadedAt: now() };
      return memo;
    }
    const snapshot = readPayload(snapshotFile);
    if (hasData(snapshot)) {
      memo = { payload: snapshot, source: 'snapshot', loadedAt: now() };
      return memo;
    }
    return null;
  }

  function loadOnce(force = false): Promise<{ payload: NoaaPayload; source: NoaaSource } | null> {
    if (!inflight) inflight = load(force).finally(() => { inflight = null; });
    return inflight;
  }

  return {
    async getCurrent() {
      const loaded = await loadOnce();
      const series = loaded?.payload.current;
      if (!loaded || !series || series.samples.length === 0) return null;
      const sample = currentAt(series, now());
      return {
        speedMps: sample.speedMps,
        towardDeg: sample.towardDeg,
        ...currentVector(sample.speedMps, sample.towardDeg),
        station: series.station,
        stationName: series.stationName,
        observedAt: sample.at,
        basis: series.basis,
        source: loaded.source,
        fetchedAt: loaded.payload.fetchedAt,
      };
    },
    async getWaterLevel() {
      const loaded = await loadOnce();
      const level = loaded?.payload.waterLevel;
      if (!loaded || !level) return null;
      return { ...level, source: loaded.source, fetchedAt: loaded.payload.fetchedAt };
    },
    refresh: () => loadOnce(true),
  };
}

let defaultClient: NoaaClient | null = null;

function sharedClient(): NoaaClient {
  defaultClient ??= createNoaaClient();
  return defaultClient;
}

export function getCurrent(): Promise<CurrentReading | null> {
  return sharedClient().getCurrent();
}

export function getWaterLevel(): Promise<WaterLevelReading | null> {
  return sharedClient().getWaterLevel();
}
