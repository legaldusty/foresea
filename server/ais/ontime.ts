import type { AisVessel, VesselTypeLabel } from '../../src/shared/ais-types';
import { vesselList, type VesselSource } from './berth';
import { distanceMeters, isInsideBreakwater, type LonLat } from './geo';
import { NAV_AT_ANCHOR, NAV_MOORED } from './normalize';
import type { HarborPoint } from './settings';

export type PortId = 'LA' | 'LB';
export type OnTimeStatus = 'on time' | 'at risk' | 'berthed' | 'anchored' | 'unknown';
export type RouteMinutes = (fromLonLat: LonLat, toLonLat: LonLat, speedKn: number) => number | null;

export interface OnTimeRow {
  mmsi: number;
  name: string;
  typeLabel: VesselTypeLabel;
  destination: string;
  port: PortId;
  reportedEta: string | null;
  ourEta: string | null;
  deltaMin: number | null;
  status: OnTimeStatus;
  why: string;
}

export interface OnTimeSettings {
  ais: {
    berthedMaxKnots: number;
    onTimeLateMinutes: number;
    onTimeMinKnots: number;
    onTimeStaleEtaHours: number;
    breakwaterLonLat: number[][];
  };
  harbor: { targets: HarborPoint[]; gates: HarborPoint[] };
}

export interface OnTimeOptions {
  routeMinutes: RouteMinutes;
  now?: number;
  settings: OnTimeSettings;
}

const PORT_GATE: Record<PortId, string> = { LA: 'Angels Gate', LB: 'Queens Gate' };

const LA_NAMES = new Set(['USLAX', 'LAX', 'USALX', 'LOSANGELES', 'PORTOFLA', 'PORTOFLOSANGELES', 'POLA', 'SANPEDRO', 'USSPQ']);
const LB_NAMES = new Set(['USLGB', 'LGB', 'LONGBEACH', 'PORTOFLONGBEACH', 'POLB', 'LBEACH']);
const SHORT_LA = 'LA';
const SHORT_LB = 'LB';
const HARBOR_WORDS = new Set(['ANCH', 'ANCHORAGE', 'PILOT', 'PILOTS', 'PORT', 'HARBOR', 'HARBOUR', 'BERTH', 'PIER', 'TERMINAL', 'US', 'USA', 'CA']);

const STATUS_ORDER: Record<OnTimeStatus, number> = { 'at risk': 0, 'on time': 1, anchored: 2, berthed: 3, unknown: 4 };

function portOfWords(words: string[]): PortId | null {
  const compact = words.join('');
  if (!compact) return null;
  if (compact === SHORT_LA) return 'LA';
  if (compact === SHORT_LB) return 'LB';
  if (LA_NAMES.has(compact) || compact.startsWith('USLAX') || compact.includes('LOSANGELES')) return 'LA';
  if (LB_NAMES.has(compact) || compact.startsWith('USLGB') || compact.includes('LONGBEACH')) return 'LB';
  for (const word of words) {
    if (LA_NAMES.has(word)) return 'LA';
    if (LB_NAMES.has(word)) return 'LB';
  }
  const rest = words.filter((word) => word !== SHORT_LA && word !== SHORT_LB);
  const onlyHarborWords = rest.every((word) => HARBOR_WORDS.has(word) || /^\d+$/.test(word));
  const hasLa = words.includes(SHORT_LA);
  const hasLb = words.includes(SHORT_LB);
  if (onlyHarborWords && hasLa !== hasLb) return hasLa ? 'LA' : 'LB';
  return null;
}

export function resolvePort(destination: string): PortId | null {
  const segments = destination.toUpperCase().split('>').map((part) => part.trim()).filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  const words = last.replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return portOfWords(words);
}

function knots(value: number): string {
  return value.toFixed(1);
}

function nearestTarget(here: LonLat, targets: HarborPoint[]): HarborPoint | null {
  let best: HarborPoint | null = null;
  let bestDistance = Infinity;
  for (const target of targets) {
    const distance = distanceMeters(here, [target.lon, target.lat]);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

function gateFor(port: PortId, gates: HarborPoint[]): HarborPoint | null {
  return gates.find((gate) => gate.name === PORT_GATE[port]) ?? null;
}

function rowFor(vessel: AisVessel, port: PortId, options: OnTimeOptions, now: number): OnTimeRow {
  const { settings, routeMinutes } = options;
  const ais = settings.ais;
  const here: LonLat = [vessel.lon, vessel.lat];
  const inside = isInsideBreakwater(here, ais.breakwaterLonLat);
  const base = {
    mmsi: vessel.mmsi,
    name: vessel.name,
    typeLabel: vessel.typeLabel,
    destination: vessel.destination,
    port,
    reportedEta: vessel.etaReported,
    ourEta: null,
    deltaMin: null,
  };
  const nav = vessel.navStatus.code;
  const stopped = vessel.sogKn !== null && vessel.sogKn <= ais.berthedMaxKnots;

  if (nav === NAV_MOORED) return { ...base, status: 'berthed', why: 'Reports moored.' };
  if (nav === NAV_AT_ANCHOR) return { ...base, status: 'anchored', why: 'Reports at anchor.' };
  if (stopped && inside) return { ...base, status: 'berthed', why: `Stopped inside the breakwater at ${knots(vessel.sogKn as number)} kn.` };
  if (stopped) return { ...base, status: 'anchored', why: `Stopped outside the breakwater at ${knots(vessel.sogKn as number)} kn.` };

  const reportedMs = vessel.etaReported ? Date.parse(vessel.etaReported) : NaN;
  if (!Number.isFinite(reportedMs)) return { ...base, status: 'unknown', why: 'No reported ETA in AIS.' };
  const reportedAgeHours = (now - reportedMs) / 3_600_000;
  if (reportedAgeHours > ais.onTimeStaleEtaHours) {
    return { ...base, status: 'unknown', why: `The reported ETA is ${Math.round(reportedAgeHours)} h in the past, so it looks stale.` };
  }
  if (vessel.sogKn === null) return { ...base, status: 'unknown', why: 'No speed over ground in AIS.' };
  if (vessel.sogKn < ais.onTimeMinKnots) {
    return { ...base, status: 'unknown', why: `Making ${knots(vessel.sogKn)} kn, too slow to project an arrival.` };
  }

  const goal = inside ? nearestTarget(here, settings.harbor.targets) : gateFor(port, settings.harbor.gates);
  if (!goal) return { ...base, status: 'unknown', why: `No ${inside ? 'target berth' : PORT_GATE[port]} in settings.` };
  const minutes = routeMinutes(here, [goal.lon, goal.lat], vessel.sogKn);
  if (minutes === null || !Number.isFinite(minutes)) return { ...base, status: 'unknown', why: `No water route to ${goal.name}.` };

  const ourMs = now + minutes * 60_000;
  const deltaMin = Math.round((ourMs - reportedMs) / 60_000);
  const status: OnTimeStatus = deltaMin > ais.onTimeLateMinutes ? 'at risk' : 'on time';
  const leg = `${Math.round(minutes)} min to ${goal.name} at ${knots(vessel.sogKn)} kn`;
  const comparison = deltaMin === 0
    ? 'matches the reported ETA'
    : `is ${Math.abs(deltaMin)} min ${deltaMin > 0 ? 'after' : 'before'} the reported ETA`;
  return { ...base, ourEta: new Date(ourMs).toISOString(), deltaMin, status, why: `${leg}, which ${comparison}.` };
}

function sortTime(row: OnTimeRow): number {
  const value = row.ourEta ?? row.reportedEta;
  return value ? Date.parse(value) : Infinity;
}

export function onTimeBoard(source: VesselSource, options: OnTimeOptions): OnTimeRow[] {
  const now = options.now ?? Date.now();
  const rows: OnTimeRow[] = [];
  for (const vessel of vesselList(source, now)) {
    const port = resolvePort(vessel.destination);
    if (port) rows.push(rowFor(vessel, port, options, now));
  }
  return rows.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || sortTime(a) - sortTime(b) || a.name.localeCompare(b.name));
}
