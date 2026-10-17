import type { Harbor } from './harbor';
import { findPath, pathLength } from './grid';
import { bearingDeg, knotsToMps, lerpLonLat, type LonLat } from './geo';
import { rng } from './bench';

export interface CraftSim {
  id: string;
  name: string;
  type: string;
  speedMps: number;
  phone: boolean;
  fleet: boolean;
  ignoresNotices: boolean;
  smallCraft: boolean;
  homeCell: number;
  awayCell: number;
  toCell: number;
  route: number[];
  routeIdx: number;
  progressM: number;
  headingDeg: number;
  baseRoute: number[];
  rerouteNoticeId: string | null;
  addedMin: number;
  tripStartMin: number;
  naturalMin: number;
  slackMin: number;
  held: boolean;
  dwellUntilMin: number | null;
  waitAtIdx: number;
  waitUntilMin: number | null;
  slowMps: number | null;
  slowUntilMin: number | null;
}

export interface CraftSeed {
  id: string;
  name: string;
  type: string;
  speedKn: number;
  fromCell: number;
  toCell: number;
  scheduledMin: number;
  phone: boolean;
  fleet: boolean;
  ignoresNotices: boolean;
  startFraction: number;
}

function routeMinutes(h: Harbor, cells: number[], speedMps: number): number {
  return cells.length > 1 ? (pathLength(h.grid, cells) * h.grid.cellMeters) / speedMps / 60 : 0;
}

export function createCraft(h: Harbor, seed: CraftSeed, t: number): CraftSim | null {
  const route = findPath(h.grid, seed.fromCell, seed.toCell);
  if (!route || route.length < 2) return null;
  const speedMps = knotsToMps(seed.speedKn);
  const naturalMin = routeMinutes(h, route, speedMps);
  const startIdx = Math.min(route.length - 2, Math.floor(route.length * seed.startFraction));
  const elapsedMin = routeMinutes(h, route.slice(0, startIdx + 1), speedMps);
  return {
    id: seed.id, name: seed.name, type: seed.type, speedMps,
    phone: seed.phone, fleet: seed.fleet, ignoresNotices: seed.ignoresNotices,
    smallCraft: !['cargo', 'tanker', 'cruise'].includes(seed.type),
    homeCell: seed.fromCell, awayCell: seed.toCell, toCell: seed.toCell,
    route, routeIdx: startIdx, progressM: 0, headingDeg: 0,
    baseRoute: route, rerouteNoticeId: null, addedMin: 0,
    tripStartMin: t - elapsedMin, naturalMin,
    slackMin: Math.max(3, seed.scheduledMin - naturalMin),
    held: false, dwellUntilMin: null,
    waitAtIdx: -1, waitUntilMin: null, slowMps: null, slowUntilMin: null,
  };
}

export function remainingRoute(c: CraftSim): number[] {
  return c.route.slice(c.routeIdx);
}

export function craftLonLat(h: Harbor, c: CraftSim): LonLat {
  const here = h.grid.toLonLat(...h.grid.xy(c.route[c.routeIdx])) as LonLat;
  const nextCell = c.route[c.routeIdx + 1];
  if (nextCell === undefined) return here;
  const there = h.grid.toLonLat(...h.grid.xy(nextCell)) as LonLat;
  return lerpLonLat(here, there, Math.min(1, c.progressM / h.grid.cellMeters));
}

export function currentCell(c: CraftSim): number {
  return c.route[c.routeIdx];
}

export function applyRoute(h: Harbor, c: CraftSim, cells: number[], noticeId: string, addedMin: number): void {
  const here = currentCell(c);
  const start = cells.indexOf(here);
  c.route = start >= 0 ? cells.slice(start) : [here, ...cells];
  c.routeIdx = 0;
  c.rerouteNoticeId = noticeId;
  c.addedMin = addedMin;
}

export function clearFix(c: CraftSim): void {
  c.waitAtIdx = -1;
  c.waitUntilMin = null;
  c.slowMps = null;
  c.slowUntilMin = null;
}

export function restoreRoute(h: Harbor, c: CraftSim): void {
  const here = currentCell(c);
  const back = findPath(h.grid, here, c.toCell);
  if (back) { c.route = back; c.routeIdx = 0; }
  c.rerouteNoticeId = null;
  clearFix(c);
}

export function effectiveSpeed(c: CraftSim, t: number): number {
  if (c.slowMps !== null && c.slowUntilMin !== null && t < c.slowUntilMin) return c.slowMps;
  return c.speedMps;
}

export function isWaiting(c: CraftSim, t: number): boolean {
  return c.waitUntilMin !== null && t < c.waitUntilMin && (c.waitAtIdx < 0 || c.routeIdx >= c.waitAtIdx);
}

function startTrip(h: Harbor, c: CraftSim, t: number, avoid: Uint8Array | null): void {
  const from = currentCell(c);
  c.toCell = c.toCell === c.awayCell ? c.homeCell : c.awayCell;
  const route = (avoid ? findPath(h.grid, from, c.toCell, avoid) : null) ?? findPath(h.grid, from, c.toCell);
  if (!route || route.length < 2) return;
  c.route = route;
  c.baseRoute = route;
  c.routeIdx = 0;
  c.progressM = 0;
  c.tripStartMin = t;
  c.naturalMin = routeMinutes(h, route, c.speedMps);
  c.addedMin = 0;
  c.rerouteNoticeId = null;
  clearFix(c);
}

export function moveCraft(h: Harbor, c: CraftSim, dtSec: number, t: number, avoid: Uint8Array | null): void {
  if (c.dwellUntilMin !== null) {
    if (t < c.dwellUntilMin) return;
    c.dwellUntilMin = null;
    startTrip(h, c, t, avoid);
    return;
  }
  if (c.held) return;
  if (c.waitUntilMin !== null && t >= c.waitUntilMin) { c.waitUntilMin = null; c.waitAtIdx = -1; }
  if (c.slowUntilMin !== null && t >= c.slowUntilMin) { c.slowUntilMin = null; c.slowMps = null; }
  if (isWaiting(c, t)) { c.progressM = 0; return; }
  c.progressM += effectiveSpeed(c, t) * dtSec;
  let guard = 0;
  while (c.progressM >= h.grid.cellMeters && guard++ < 100) {
    const nextCell = c.route[c.routeIdx + 1];
    if (nextCell === undefined) { c.progressM = 0; c.dwellUntilMin = t + 3; return; }
    const from = c.route[c.routeIdx];
    c.headingDeg = bearingDeg(h.grid.toLonLat(...h.grid.xy(from)) as LonLat, h.grid.toLonLat(...h.grid.xy(nextCell)) as LonLat);
    c.routeIdx++;
    c.progressM -= h.grid.cellMeters;
    if (isWaiting(c, t)) { c.progressM = 0; return; }
  }
}

export function plannedArrivalMin(c: CraftSim): number {
  return c.tripStartMin + c.naturalMin + c.slackMin;
}

export function ourArrivalMin(h: Harbor, c: CraftSim, t: number): number {
  if (c.dwellUntilMin !== null) return t;
  return t + routeMinutes(h, remainingRoute(c), c.speedMps);
}

const FLEET_TYPES: { type: string; label: string; speedKn: number }[] = [
  { type: 'sail', label: 'Sailboat', speedKn: 5 },
  { type: 'fishing', label: 'Sportfisher', speedKn: 9 },
  { type: 'taxi', label: 'Harbor tour', speedKn: 8 },
  { type: 'pleasure', label: 'Motor yacht', speedKn: 10 },
];

export function fleetSeeds(h: Harbor, count: number, seed: number): CraftSeed[] {
  const rand = rng(seed);
  const anchors = [...h.targets.map((t) => t.cell), ...h.gates.map((g) => g.cell), ...h.places.map((p) => p.cell)];
  const out: CraftSeed[] = [];
  for (let k = 0; k < count; k++) {
    const kind = FLEET_TYPES[k % FLEET_TYPES.length];
    const from = anchors[Math.floor(rand() * anchors.length)];
    let to = anchors[Math.floor(rand() * anchors.length)];
    if (to === from) to = anchors[(anchors.indexOf(from) + 1) % anchors.length];
    out.push({
      id: `fleet${k + 1}`, name: `${kind.label} ${k + 1}`, type: kind.type, speedKn: kind.speedKn,
      fromCell: from, toCell: to, scheduledMin: 0, phone: false, fleet: true, ignoresNotices: false, startFraction: rand(),
    });
  }
  return out;
}
