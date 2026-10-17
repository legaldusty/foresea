import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import giveWaySettings from '../../settings/giveway.settings.json';
import type * as P from '../../src/shared/protocol';
import { freshEnough, type FetchContext, type Observation, type SourceStatus, type TextFetch } from './http';
import { buoyObservedAt, fetchBuoy, type BuoyReading } from './ndbc';
import { fetchStationValue, fetchTide, fetchWind, nextTurns, type StationValue, type TideReading, type TideTurn, type WindValue } from './coops';
import { fetchAlerts, fetchZoneForecast, type NwsAdvisory, type ZoneForecast } from './nws';

export const CONDITIONS_CACHE_FILE = fileURLToPath(new URL('../../data/cache/conditions.json', import.meta.url));

export type Group = 'buoys' | 'tide' | 'met' | 'alerts' | 'forecast';

export interface ConditionsSettings {
  noaa: { waterLevelStation: string };
  conditions: {
    buoys: { id: string; name: string }[];
    windStations: string[];
    airTempStations: string[];
    pressureStations: string[];
    tideDatum: string;
    tideTrendMinutes: number;
    tideSteadyMeters: number;
    tidePredictionHours: number;
    nwsZone: string;
    nwsZoneName: string;
    nwsAlertZones: string[];
    forecastPeriods: number;
    userAgent: string;
    refreshMinutes: Record<Group, number>;
    maxAgeMinutes: { buoy: number; station: number; alerts: number; forecast: number };
    requestTimeoutSeconds: number;
  };
}

type SlotData = BuoyReading | TideReading | WindValue | StationValue | NwsAdvisory[] | ZoneForecast;

export interface Slot<T extends SlotData = SlotData> extends SourceStatus {
  id: string;
  group: Group;
  label: string;
  fetchedAt: string | null;
  lastGoodAt: string | null;
  data: T | null;
}

interface CacheFile { savedAt: string; slots: Slot[] }

const iso = (ms: number) => new Date(ms).toISOString();
const utcClock = (at: string | null) => (at ? `${at.slice(11, 16)} UTC` : 'unknown');

function minutesAgo(at: string | null, now: number): string {
  if (!at) return 'never';
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (m < 1) return 'under 1 min ago';
  if (m < 90) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function makeSlots(s: ConditionsSettings): Slot[] {
  const c = s.conditions;
  const slot = (id: string, group: Group, label: string): Slot => ({ id, group, label, ok: false, detail: 'Not fetched yet', observedAt: null, fetchedAt: null, lastGoodAt: null, data: null });
  return [
    ...c.buoys.map((b) => slot(`buoy:${b.id}`, 'buoys', `NDBC ${b.id} ${b.name}`)),
    slot('tide', 'tide', `CO-OPS ${s.noaa.waterLevelStation} tide`),
    slot('wind', 'met', 'CO-OPS wind'),
    slot('airTemp', 'met', 'CO-OPS air temperature'),
    slot('pressure', 'met', 'CO-OPS pressure'),
    slot('alerts', 'alerts', `NWS alerts ${c.nwsAlertZones.join(', ')}`),
    slot('forecast', 'forecast', `NWS forecast ${c.nwsZone}`),
  ];
}

function sourced<T>(value: T, source: string, observedAt: string, now: number): P.Sourced<T> {
  return { value, source, observedAt, ageMin: Math.max(0, (now - Date.parse(observedAt)) / 60_000) };
}

function failureNote(slots: Slot[], now: number): string {
  return slots.map((s) => (s.ok ? `${s.label} ok` : `${s.label}: ${s.detail}${s.lastGoodAt ? `, last good ${minutesAgo(s.lastGoodAt, now)}` : ''}`)).join('; ');
}

export function buildConditionsView(slots: Slot[], s: ConditionsSettings, now: number): P.ConditionsView {
  const c = s.conditions;
  const missing: P.ConditionsView['missing'] = {};
  const byId = (id: string) => slots.find((x) => x.id === id) ?? null;
  const buoySlots = slots.filter((x) => x.group === 'buoys');

  const fromBuoys = (field: P.ConditionsField, pick: (b: BuoyReading) => Observation | null, what: string): P.Sourced<number> | null => {
    for (const slot of buoySlots) {
      const b = slot.data as BuoyReading | null;
      const o = b ? pick(b) : null;
      if (o && freshEnough(o.at, now, c.maxAgeMinutes.buoy)) return sourced(o.value, slot.label, o.at, now);
    }
    missing[field] = buoySlots.some((x) => x.ok)
      ? `No ${what} from ${buoySlots.map((x) => x.label).join(' or ')} in the last ${c.maxAgeMinutes.buoy} min`
      : `No buoy answered. ${failureNote(buoySlots, now)}`;
    return null;
  };

  const fromStation = <T extends { at: string; station: string; stationName: string }, V>(field: P.ConditionsField, slotId: string, kind: string, what: string, value: (d: T) => V | null): P.Sourced<V> | null => {
    const slot = byId(slotId);
    const d = slot?.data as T | null;
    const v = d ? value(d) : null;
    if (d && v !== null && freshEnough(d.at, now, c.maxAgeMinutes.station)) return sourced(v, `CO-OPS ${d.station} ${d.stationName} ${kind}`, d.at, now);
    missing[field] = slot && !slot.ok ? `No data. ${slot.label}: ${slot.detail}${slot.lastGoodAt ? `. Last good ${minutesAgo(slot.lastGoodAt, now)}` : ''}` : `No ${what} reported by CO-OPS in the last ${c.maxAgeMinutes.station} min`;
    return null;
  };

  const tideSlot = byId('tide');
  const tide = tideSlot?.data as TideReading | null;
  const tideSource = tide ? `CO-OPS ${tide.station} ${tide.stationName}` : 'CO-OPS';
  const tideFailed = tideSlot && !tideSlot.ok ? `${tideSlot.label}: ${tideSlot.detail}${tideSlot.lastGoodAt ? `. Last good ${minutesAgo(tideSlot.lastGoodAt, now)}` : ''}` : null;
  let waterLevelM: P.Sourced<number> | null = null;
  let tideTrend: P.Sourced<P.TideTrend> | null = null;
  if (tide?.level && freshEnough(tide.level.at, now, c.maxAgeMinutes.station)) {
    waterLevelM = sourced(tide.level.meters, `${tideSource}, observed`, tide.level.at, now);
    if (tide.trend) tideTrend = sourced(tide.trend, `${tideSource}, last ${c.tideTrendMinutes} min`, tide.level.at, now);
    else missing.tideTrend = 'Not enough recent readings for a trend';
  } else {
    missing.waterLevel = tideFailed ?? `No water level in the last ${c.maxAgeMinutes.station} min`;
    missing.tideTrend = missing.waterLevel;
  }
  const turns = nextTurns(tide?.turns ?? [], now);
  const turnView = (t: TideTurn | null, field: P.ConditionsField): P.Sourced<P.TideTurnView> | null => {
    if (t && tideSlot?.lastGoodAt) return sourced({ kind: t.kind, at: t.at, label: '', meters: t.meters }, `${tideSource}, predicted`, tideSlot.lastGoodAt, now);
    missing[field] = tideFailed ?? 'No prediction ahead of now';
    return null;
  };

  const alertsSlot = byId('alerts');
  let advisories: P.ConditionsView['advisories'] = null;
  if (alertsSlot?.data && freshEnough(alertsSlot.lastGoodAt, now, c.maxAgeMinutes.alerts)) {
    const list = (alertsSlot.data as NwsAdvisory[]).filter((a) => !a.ends || Date.parse(a.ends) > now).map((a) => ({ ...a, endsLabel: null, relayedBy: null, relayedAtLabel: null }));
    advisories = sourced(list, alertsSlot.label, alertsSlot.lastGoodAt as string, now);
  } else {
    missing.advisories = alertsSlot && !alertsSlot.ok ? `No data. ${alertsSlot.label}: ${alertsSlot.detail}${alertsSlot.lastGoodAt ? `. Last good list ${minutesAgo(alertsSlot.lastGoodAt, now)}` : ''}` : 'No alert list fetched yet';
  }

  const forecastSlot = byId('forecast');
  let forecast: P.ConditionsView['forecast'] = null;
  const zf = forecastSlot?.data as ZoneForecast | null;
  const forecastAt = zf ? zf.issuedAt ?? forecastSlot?.lastGoodAt ?? null : null;
  if (zf && forecastAt && freshEnough(forecastAt, now, c.maxAgeMinutes.forecast)) {
    forecast = sourced({ zone: c.nwsZone, zoneName: c.nwsZoneName, issuedAt: zf.issuedAt, periods: zf.periods }, `NWS zone forecast ${c.nwsZone}`, forecastAt, now);
  } else {
    missing.forecast = forecastSlot && !forecastSlot.ok ? `No data. ${forecastSlot.label}: ${forecastSlot.detail}${forecastSlot.lastGoodAt ? `. Last good ${minutesAgo(forecastSlot.lastGoodAt, now)}` : ''}` : 'No forecast fetched yet';
  }

  return {
    datum: c.tideDatum,
    waterLevelM,
    tideTrend,
    nextHigh: turnView(turns.high, 'nextHigh'),
    nextLow: turnView(turns.low, 'nextLow'),
    windMps: fromStation<WindValue, number>('wind', 'wind', 'wind', 'wind speed', (d) => d.speedMps),
    gustMps: fromStation<WindValue, number>('gust', 'wind', 'wind', 'gust', (d) => d.gustMps),
    windFromDeg: fromStation<WindValue, number>('windFrom', 'wind', 'wind', 'wind direction', (d) => d.fromDeg),
    waveHeightM: fromBuoys('waveHeight', (b) => b.waveHeightM, 'wave height'),
    wavePeriodS: fromBuoys('wavePeriod', (b) => b.dominantPeriodS, 'wave period'),
    waveFromDeg: fromBuoys('waveFrom', (b) => b.waveFromDeg, 'wave direction'),
    waterTempC: fromBuoys('waterTemp', (b) => b.waterTempC, 'water temperature'),
    airTempC: fromStation<StationValue, number>('airTemp', 'airTemp', 'air temperature', 'air temperature', (d) => d.value),
    pressureHpa: fromStation<StationValue, number>('pressure', 'pressure', 'pressure', 'pressure', (d) => d.value),
    sunrise: null,
    sunset: null,
    advisories,
    forecast,
    missing,
    sources: slots.map((x) => ({ id: x.id, label: x.label, ok: x.ok, detail: x.detail, observedAt: x.observedAt, ageMin: x.observedAt ? Math.max(0, (now - Date.parse(x.observedAt)) / 60_000) : null })),
  };
}

export function readConditionsCache(file: string): Slot[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile;
    return Array.isArray(parsed?.slots) ? parsed.slots : null;
  } catch {
    return null;
  }
}

function writeCacheQuietly(file: string, slots: Slot[], now: number): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ savedAt: iso(now), slots } satisfies CacheFile, null, 2)}\n`);
  } catch {
    return;
  }
}

export interface ConditionsClientOptions {
  settings?: ConditionsSettings;
  fetch?: TextFetch;
  cacheFile?: string;
  now?: () => number;
}

export interface ConditionsClient {
  refreshDue(): Promise<void>;
  refresh(groups?: Group[]): Promise<void>;
  view(): P.ConditionsView;
  status(): Record<string, SourceStatus>;
  slots(): Slot[];
}

export function createConditionsClient(options: ConditionsClientOptions = {}): ConditionsClient {
  const settings = options.settings ?? (giveWaySettings as unknown as ConditionsSettings);
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as TextFetch);
  const cacheFile = options.cacheFile ?? CONDITIONS_CACHE_FILE;
  const now = options.now ?? Date.now;
  const c = settings.conditions;
  const slots = makeSlots(settings);
  const lastTry = new Map<Group, number>();
  const inflight = new Map<Group, Promise<void>>();

  for (const cached of readConditionsCache(cacheFile) ?? []) {
    const slot = slots.find((x) => x.id === cached.id);
    if (!slot || !cached.data) continue;
    Object.assign(slot, { label: cached.label ?? slot.label, data: cached.data, observedAt: cached.observedAt, fetchedAt: cached.fetchedAt, lastGoodAt: cached.lastGoodAt, ok: false, detail: `From the cache file, fetched ${minutesAgo(cached.lastGoodAt, now())}` });
  }

  const ctx = (): FetchContext => ({ fetch: fetchImpl, timeoutMs: c.requestTimeoutSeconds * 1000, userAgent: c.userAgent, now: now() });

  async function run<T extends SlotData>(slot: Slot, load: () => Promise<{ data: T; observedAt: string | null; detail: string }>): Promise<void> {
    const started = now();
    try {
      const result = await load();
      Object.assign(slot, { ok: true, data: result.data, observedAt: result.observedAt, detail: result.detail, fetchedAt: iso(started), lastGoodAt: iso(started) });
    } catch (err) {
      Object.assign(slot, { ok: false, detail: (err as Error).message, fetchedAt: iso(started) });
    }
  }

  const slot = (id: string) => slots.find((x) => x.id === id) as Slot;
  const station = c.maxAgeMinutes.station;

  const loaders: Record<Group, () => Promise<unknown>> = {
    buoys: () => Promise.all(c.buoys.map((b) => run(slot(`buoy:${b.id}`), async () => {
      const reading = await fetchBuoy(ctx(), b, c.maxAgeMinutes.buoy);
      const observedAt = buoyObservedAt(reading);
      return { data: reading, observedAt, detail: observedAt ? `Newest row ${utcClock(reading.newestRowAt)}` : `No wave or water readings in the last ${c.maxAgeMinutes.buoy} min` };
    }))),
    tide: () => run(slot('tide'), async () => {
      const tide = await fetchTide(ctx(), settings.noaa.waterLevelStation, { datum: c.tideDatum, trendMinutes: c.tideTrendMinutes, steadyMeters: c.tideSteadyMeters, predictionHours: c.tidePredictionHours });
      slot('tide').label = `CO-OPS ${tide.station} ${tide.stationName} tide`;
      return { data: tide, observedAt: tide.level?.at ?? null, detail: `${tide.level ? 'Water level observed' : 'No water level'}, ${tide.turns.length} predicted highs and lows` };
    }),
    met: () => Promise.all([
      run(slot('wind'), async () => {
        const w = await fetchWind(ctx(), c.windStations, station);
        slot('wind').label = `CO-OPS ${w.station} ${w.stationName} wind`;
        return { data: w, observedAt: w.at, detail: `Wind from station ${w.station}` };
      }),
      run(slot('airTemp'), async () => {
        const v = await fetchStationValue(ctx(), c.airTempStations, 'air_temperature', station);
        slot('airTemp').label = `CO-OPS ${v.station} ${v.stationName} air temperature`;
        return { data: v, observedAt: v.at, detail: `Air temperature from station ${v.station}` };
      }),
      run(slot('pressure'), async () => {
        const v = await fetchStationValue(ctx(), c.pressureStations, 'air_pressure', station);
        slot('pressure').label = `CO-OPS ${v.station} ${v.stationName} pressure`;
        return { data: v, observedAt: v.at, detail: `Pressure from station ${v.station}` };
      }),
    ]),
    alerts: () => run(slot('alerts'), async () => {
      const list = await fetchAlerts(ctx(), c.nwsAlertZones);
      return { data: list, observedAt: iso(now()), detail: list.length ? `${list.length} in effect: ${list.map((a) => a.event).join(', ')}` : 'None in effect' };
    }),
    forecast: () => run(slot('forecast'), async () => {
      const f = await fetchZoneForecast(ctx(), c.nwsZone, c.forecastPeriods);
      return { data: f, observedAt: f.issuedAt ?? iso(now()), detail: f.issuedAt ? `Issued ${utcClock(f.issuedAt)}` : 'Issue time not usable; age is the fetch time' };
    }),
  };

  function refreshGroup(group: Group): Promise<void> {
    const running = inflight.get(group);
    if (running) return running;
    lastTry.set(group, now());
    const p = loaders[group]().then(() => undefined).finally(() => inflight.delete(group));
    inflight.set(group, p);
    return p;
  }

  async function refresh(groups: Group[] = ['buoys', 'tide', 'met', 'alerts', 'forecast']): Promise<void> {
    await Promise.all(groups.map(refreshGroup));
    writeCacheQuietly(cacheFile, slots, now());
  }

  return {
    refresh,
    refreshDue() {
      const due = (Object.keys(c.refreshMinutes) as Group[]).filter((g) => now() - (lastTry.get(g) ?? -Infinity) >= c.refreshMinutes[g] * 60_000);
      return due.length ? refresh(due) : Promise.resolve();
    },
    view: () => buildConditionsView(slots, settings, now()),
    status: () => Object.fromEntries(slots.map((x) => [x.id, { ok: x.ok, detail: x.detail, observedAt: x.observedAt }])),
    slots: () => slots,
  };
}
