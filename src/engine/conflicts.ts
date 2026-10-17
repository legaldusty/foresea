import type { Grid } from './grid';
import type { GridLike } from './zones';
import { forecastShapes, type Forecast, type ForecastShapes } from './forecast';
import { distanceField } from './grid';
import { planRoute, rerouteAround } from './routing';
import type { Priority } from './priority';

export interface NoticeArea {
  madeAtMin: number;
  likely: Uint8Array;
  careful: Uint8Array;
  early: Float32Array;
  late: Float32Array;
  topTarget: number;
  contactCell: number;
}

export interface NoticeAreaOptions {
  horizonMinutes: number;
  zoneMeters: number;
  carefulShare: number;
  exitMinutesMax: number;
}

export type CrossingLayer = 'likely' | 'careful';

export interface Crossing {
  layer: CrossingLayer;
  index: number;
  cell: number;
  boatMin: number;
  droneEarlyMin: number;
  droneLateMin: number;
}

export type FixKind = 'hold' | 'slow' | 'stepAside' | 'reroute';
export type BoatAction = 'none' | 'headsUp' | FixKind;

export interface PricedFix {
  kind: FixKind;
  feasible: boolean;
  addedMin: number;
  untilMin: number | null;
  slowKnots: number | null;
  cells: number[] | null;
  waitIndex: number;
  slowUntilIndex: number;
  asideMeters: number | null;
  asideToward: number | null;
  why: string;
}

export interface PlannerBoat {
  id: string;
  name: string;
  route: number[];
  speedMps: number;
  waitIndex: number;
  waitUntilMin: number;
  slowUntilIndex: number;
  slowMps: number;
  movable: boolean;
  alongside: boolean;
}

export interface PlannerRules {
  padMinutes: number;
  p1Minutes: number;
  p2Minutes: number;
  maxDelayPerBoatMin: number;
  minSlowKnots: number;
  stepAsideMaxMeters: number;
  searchStepMinutes: number;
}

export interface BoatPlan {
  id: string;
  name: string;
  crossing: Crossing | null;
  priority: Priority;
  action: BoatAction;
  addedMin: number;
  untilMin: number | null;
  fix: PricedFix | null;
  options: PricedFix[];
  noGentleOption: boolean;
}

export interface ConflictPlan {
  boats: BoatPlan[];
  affected: BoatPlan[];
  totalAddedMin: number;
  maxAddedMin: number;
  noGentle: BoatPlan[];
}

interface Visit {
  cell: number;
  enter: number;
  leave: number;
}

const KNOT = 0.514444;
const FIX_ORDER: FixKind[] = ['hold', 'slow', 'stepAside', 'reroute'];

export function buildNoticeArea(grid: GridLike, f: Forecast, contactCell: number, contactSpeedMps: number, o: NoticeAreaOptions, madeAtMin: number): NoticeArea {
  const size = grid.nx * grid.ny;
  const likely = new Uint8Array(size);
  const careful = new Uint8Array(size);
  const early = new Float32Array(size).fill(NaN);
  const late = new Float32Array(size).fill(NaN);
  for (let j = 0; j < size; j++) {
    const e = f.timeEarly[j];
    if (Number.isNaN(e) || e > o.horizonMinutes) continue;
    const inLikely = f.likely[j] === 1;
    const inCareful = inLikely || f.passShare[j] >= o.carefulShare;
    if (!inCareful) continue;
    careful[j] = 1;
    if (inLikely) likely[j] = 1;
    early[j] = e;
    late[j] = f.timeLate[j];
  }
  const radius = o.zoneMeters / grid.cellMeters;
  const exitMin = Math.min(o.exitMinutesMax, o.zoneMeters / Math.max(0.05, contactSpeedMps) / 60);
  const [cx, cy] = grid.xy(contactCell);
  const R = Math.ceil(radius);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > radius * radius) continue;
    const X = cx + dx;
    const Y = cy + dy;
    if (!grid.inBounds(X, Y)) continue;
    const j = grid.idx(X, Y);
    if (!grid.water[j]) continue;
    likely[j] = 1;
    careful[j] = 1;
    early[j] = 0;
    late[j] = Number.isNaN(late[j]) ? exitMin : Math.max(late[j], exitMin);
  }
  return { madeAtMin, likely, careful, early, late, topTarget: f.topTarget, contactCell };
}

export function noticeAreaShapes(grid: Grid, area: NoticeArea): ForecastShapes {
  const asForecast = { likely: area.likely, passShare: Float32Array.from(area.careful) } as unknown as Forecast;
  return forecastShapes(grid, asForecast, 0.5);
}

export function overlapShare(fresh: Uint8Array, published: Uint8Array): number {
  let inside = 0;
  let total = 0;
  for (let j = 0; j < fresh.length; j++) {
    if (!fresh[j]) continue;
    total++;
    if (published[j]) inside++;
  }
  return total ? inside / total : 1;
}

function stepMinutes(grid: GridLike, a: number, b: number, speedMps: number): number {
  const [ax, ay] = grid.xy(a);
  const [bx, by] = grid.xy(b);
  return (Math.hypot(bx - ax, by - ay) * grid.cellMeters) / speedMps / 60;
}

function walk(grid: GridLike, cells: number[], speedMps: number, waitIndex: number, waitUntilMin: number, slowUntilIndex: number, slowMps: number): Visit[] {
  const out: Visit[] = [];
  let t = 0;
  for (let k = 0; k < cells.length; k++) {
    const enter = t;
    if (k === waitIndex) t = Math.max(t, waitUntilMin);
    const next = cells[k + 1];
    if (next === undefined) {
      out.push({ cell: cells[k], enter, leave: t });
      break;
    }
    t += stepMinutes(grid, cells[k], next, k < slowUntilIndex ? slowMps : speedMps);
    out.push({ cell: cells[k], enter, leave: t });
  }
  return out;
}

function arrival(visits: Visit[]): number {
  return visits.length ? visits[visits.length - 1].enter : 0;
}

function meeting(area: NoticeArea, visits: Visit[], offsetMin: number, padMin: number, layer: CrossingLayer, from = 0, escapeUntil = 0): Crossing | null {
  const mask = layer === 'likely' ? area.likely : area.careful;
  for (let k = from; k < visits.length; k++) {
    const v = visits[k];
    if (!mask[v.cell]) continue;
    const e = area.early[v.cell] - offsetMin;
    const l = area.late[v.cell] - offsetMin;
    const pad = k < escapeUntil ? 0 : padMin;
    if (Number.isNaN(e) || l + pad < 0) continue;
    if (v.enter <= l + pad && v.leave >= e - pad) {
      return { layer, index: k, cell: v.cell, boatMin: v.enter, droneEarlyMin: Math.max(0, e), droneLateMin: Math.max(0, l) };
    }
  }
  return null;
}

function lastLikelyIndex(area: NoticeArea, cells: number[]): number {
  let last = -1;
  for (let k = 0; k < cells.length; k++) if (area.likely[cells[k]]) last = k;
  return last;
}

function stepAsideCell(grid: GridLike, from: number, area: NoticeArea, maxCells: number): number[] | null {
  if (!area.careful[from]) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  const depth = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const i = queue.shift() as number;
    if (!area.careful[i]) {
      const path = [i];
      let c = prev.get(i) as number;
      while (c !== -1) { path.push(c); c = prev.get(c) as number; }
      return path.reverse();
    }
    const d = depth.get(i) as number;
    if (d >= maxCells) continue;
    const nb = grid.neighbors[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k];
      if (prev.has(j)) continue;
      prev.set(j, i);
      depth.set(j, d + 1);
      queue.push(j);
    }
  }
  return null;
}

function bearingCells(grid: GridLike, a: number, b: number): number {
  const [ax, ay] = grid.xy(a);
  const [bx, by] = grid.xy(b);
  return ((Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI + 360) % 360;
}

function infeasible(kind: FixKind, why: string): PricedFix {
  return { kind, feasible: false, addedMin: Infinity, untilMin: null, slowKnots: null, cells: null, waitIndex: -1, slowUntilIndex: -1, asideMeters: null, asideToward: null, why };
}

function startIndex(boat: PlannerBoat): number {
  return boat.alongside ? 1 : 0;
}

function departWait(boat: PlannerBoat): number {
  return boat.waitIndex === 0 ? boat.waitUntilMin : 0;
}

function escapeLength(area: NoticeArea, cells: number[]): number {
  let k = 0;
  while (k < cells.length && area.careful[cells[k]]) k++;
  return k;
}

function stillMeets(area: NoticeArea, visits: Visit[], offset: number, r: PlannerRules, boat: PlannerBoat, leavesNow = true): boolean {
  const from = boat.alongside || leavesNow ? 1 : 0;
  const escape = leavesNow ? escapeLength(area, visits.map((v) => v.cell)) : 0;
  return meeting(area, visits, offset, r.padMinutes, 'likely', from, escape) !== null;
}

function priceHold(grid: GridLike, area: NoticeArea, boat: PlannerBoat, base: number, offset: number, r: PlannerRules): PricedFix {
  const from = departWait(boat);
  for (let w = from + r.searchStepMinutes; w <= from + r.maxDelayPerBoatMin + 1e-9; w += r.searchStepMinutes) {
    const visits = walk(grid, boat.route, boat.speedMps, 0, w, -1, boat.speedMps);
    if (stillMeets(area, visits, offset, r, boat, false)) continue;
    const where = boat.alongside ? 'at its berth' : 'where it is';
    return { kind: 'hold', feasible: true, addedMin: Math.max(0, arrival(visits) - base), untilMin: w, slowKnots: null, cells: boat.route, waitIndex: 0, slowUntilIndex: -1, asideMeters: null, asideToward: null, why: `Waits ${Math.round(w - from)} min ${where}, then carries on` };
  }
  return infeasible('hold', 'Waiting does not clear the window within the signed limit');
}

function priceSlow(grid: GridLike, area: NoticeArea, boat: PlannerBoat, base: number, offset: number, r: PlannerRules): PricedFix {
  const end = lastLikelyIndex(area, boat.route);
  if (end < 0) return infeasible('slow', 'Its route does not cross the red area');
  const fullKn = boat.speedMps / KNOT;
  for (let kn = Math.ceil(fullKn) - 1; kn >= r.minSlowKnots; kn--) {
    if (kn * KNOT >= boat.speedMps) continue;
    const visits = walk(grid, boat.route, boat.speedMps, boat.waitIndex, boat.waitUntilMin, end + 1, kn * KNOT);
    if (stillMeets(area, visits, offset, r, boat)) continue;
    const added = arrival(visits) - base;
    if (added > r.maxDelayPerBoatMin) break;
    return { kind: 'slow', feasible: true, addedMin: Math.max(0, added), untilMin: visits[Math.min(end + 1, visits.length - 1)].enter, slowKnots: kn, cells: boat.route, waitIndex: boat.waitIndex, slowUntilIndex: end + 1, asideMeters: null, asideToward: null, why: `Slows to ${kn} kn until it is past the area` };
  }
  return infeasible('slow', `Slowing to ${r.minSlowKnots} kn still meets it`);
}

function priceStepAside(grid: GridLike, area: NoticeArea, boat: PlannerBoat, base: number, offset: number, r: PlannerRules): PricedFix {
  if (boat.alongside) return infeasible('stepAside', 'Alongside a berth; staying there is simpler');
  const aside = stepAsideCell(grid, boat.route[0], area, Math.ceil(r.stepAsideMaxMeters / grid.cellMeters));
  if (!aside || aside.length < 2) return infeasible('stepAside', 'No open water outside the area within reach');
  const spot = aside[aside.length - 1];
  const back = planRoute(grid, spot, boat.route[boat.route.length - 1]);
  if (!back) return infeasible('stepAside', 'No way back to its route from open water');
  const cells = [...aside, ...back.slice(1)];
  const waitIndex = aside.length - 1;
  const [sx, sy] = grid.xy(spot);
  const [bx, by] = grid.xy(boat.route[0]);
  const meters = Math.max(100, Math.round((Math.hypot(sx - bx, sy - by) * grid.cellMeters) / 50) * 50);
  const reach = arrival(walk(grid, aside, boat.speedMps, -1, 0, -1, boat.speedMps));
  for (let w = 0; w <= r.maxDelayPerBoatMin + 1e-9; w += r.searchStepMinutes) {
    const until = reach + w;
    const visits = walk(grid, cells, boat.speedMps, waitIndex, until, -1, boat.speedMps);
    if (stillMeets(area, visits, offset, r, boat)) continue;
    const added = arrival(visits) - base;
    if (added > r.maxDelayPerBoatMin) break;
    return { kind: 'stepAside', feasible: true, addedMin: Math.max(0, added), untilMin: until, slowKnots: null, cells, waitIndex, slowUntilIndex: -1, asideMeters: meters, asideToward: bearingCells(grid, boat.route[0], spot), why: `Moves ${meters} m to open water and waits` };
  }
  return infeasible('stepAside', 'Stepping aside does not clear the window within the signed limit');
}

function deviation(grid: GridLike, oldCells: number[], newCells: number[]): { meters: number; towardDeg: number } {
  let best = 0;
  let from = oldCells[0];
  let to = oldCells[0];
  for (const c of newCells) {
    const [x, y] = grid.xy(c);
    let near = Infinity;
    let nearCell = oldCells[0];
    for (const o of oldCells) {
      const [ox, oy] = grid.xy(o);
      const d = Math.hypot(x - ox, y - oy);
      if (d < near) { near = d; nearCell = o; }
    }
    if (near > best) { best = near; from = nearCell; to = c; }
  }
  return { meters: Math.max(100, Math.round((best * grid.cellMeters) / 50) * 50), towardDeg: bearingCells(grid, from, to) };
}

function priceReroute(grid: GridLike, area: NoticeArea, boat: PlannerBoat, base: number, offset: number, r: PlannerRules, crossing: Crossing): PricedFix {
  const reach = distanceField(grid as never, boat.route[0]);
  const depart = departWait(boat);
  const active = new Uint8Array(area.likely.length);
  for (let j = 0; j < active.length; j++) {
    if (!area.likely[j] || !Number.isFinite(reach[j])) continue;
    const e = area.early[j] - offset - r.padMinutes;
    const l = area.late[j] - offset + r.padMinutes;
    const soonest = depart + (reach[j] * grid.cellMeters) / boat.speedMps / 60;
    if (l >= soonest && e <= soonest + r.maxDelayPerBoatMin) active[j] = 1;
  }
  const result = rerouteAround(grid, boat.route, active, boat.speedMps);
  if (result.status !== 'rerouted' && result.status !== 'leaveZone') return infeasible('reroute', result.status === 'noPath' ? 'No way around without crossing it' : 'Its destination is inside the area');
  const visits = walk(grid, result.cells, boat.speedMps, boat.waitIndex === 0 ? 0 : -1, depart, -1, boat.speedMps);
  if (stillMeets(area, visits, offset, r, boat)) return infeasible('reroute', 'The way around still meets it');
  const added = arrival(visits) - base;
  if (added > r.maxDelayPerBoatMin) return infeasible('reroute', `The way around adds ${Math.round(added)} min, over the signed limit`);
  const side = deviation(grid, boat.route, result.cells);
  return {
    kind: 'reroute', feasible: true, addedMin: Math.max(0, added), untilMin: crossing.droneLateMin + r.padMinutes, slowKnots: null, cells: result.cells,
    waitIndex: boat.waitIndex === 0 ? 0 : -1, slowUntilIndex: -1, asideMeters: side.meters, asideToward: side.towardDeg,
    why: `Passes ${side.meters} m to the ${compassWord(side.towardDeg).toLowerCase()}, +${Math.max(0, Math.round(added))} min`,
  };
}

export function priorityForCrossing(crossing: Crossing | null, r: Pick<PlannerRules, 'p1Minutes' | 'p2Minutes'>): Priority {
  if (!crossing) return 'P4';
  if (crossing.layer === 'careful') return 'P3';
  if (crossing.boatMin <= r.p1Minutes) return 'P1';
  if (crossing.boatMin <= r.p2Minutes) return 'P2';
  return 'P3';
}

export function boatCrossing(grid: GridLike, area: NoticeArea, boat: PlannerBoat, nowMin: number, padMin: number): Crossing | null {
  const offset = nowMin - area.madeAtMin;
  const visits = walk(grid, boat.route, boat.speedMps, boat.waitIndex, boat.waitUntilMin, boat.slowUntilIndex, boat.slowMps);
  const from = startIndex(boat);
  return meeting(area, visits, offset, padMin, 'likely', from) ?? meeting(area, visits, offset, padMin, 'careful', from);
}

export function planBoat(grid: GridLike, area: NoticeArea, boat: PlannerBoat, nowMin: number, r: PlannerRules): BoatPlan {
  const offset = nowMin - area.madeAtMin;
  const crossing = boatCrossing(grid, area, boat, nowMin, r.padMinutes);
  const priority = priorityForCrossing(crossing, r);
  const plan: BoatPlan = { id: boat.id, name: boat.name, crossing, priority, action: 'none', addedMin: 0, untilMin: null, fix: null, options: [], noGentleOption: false };
  if (!crossing) return plan;
  if (priority === 'P3') { plan.action = 'headsUp'; return plan; }
  if (!boat.movable) { plan.action = 'headsUp'; return plan; }
  const base = arrival(walk(grid, boat.route, boat.speedMps, boat.waitIndex, boat.waitUntilMin, -1, boat.speedMps));
  const options = [
    priceHold(grid, area, boat, base, offset, r),
    priceSlow(grid, area, boat, base, offset, r),
    priceStepAside(grid, area, boat, base, offset, r),
    priceReroute(grid, area, boat, base, offset, r, crossing),
  ];
  plan.options = options;
  const feasible = options.filter((o) => o.feasible).sort((a, b) => a.addedMin - b.addedMin || FIX_ORDER.indexOf(a.kind) - FIX_ORDER.indexOf(b.kind));
  const pick = feasible[0] ?? null;
  if (!pick) { plan.noGentleOption = true; plan.action = 'headsUp'; return plan; }
  plan.fix = pick;
  plan.action = pick.kind;
  plan.addedMin = pick.addedMin;
  plan.untilMin = pick.untilMin;
  return plan;
}

export function planConflicts(grid: GridLike, area: NoticeArea, boats: PlannerBoat[], nowMin: number, r: PlannerRules): ConflictPlan {
  const planned = boats.map((b) => planBoat(grid, area, b, nowMin, r));
  const affected = planned.filter((p) => p.action !== 'none');
  const fixes = planned.filter((p) => p.fix);
  return {
    boats: planned,
    affected,
    totalAddedMin: fixes.reduce((s, p) => s + p.addedMin, 0),
    maxAddedMin: Math.max(0, ...fixes.map((p) => p.addedMin)),
    noGentle: planned.filter((p) => p.noGentleOption),
  };
}

export function compassWord(deg: number): string {
  const words = ['NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST'];
  return words[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function fixInstruction(fix: PricedFix | null, action: BoatAction): string {
  if (action === 'headsUp') return 'NO ACTION NEEDED YET';
  if (!fix) return 'NO ACTION NEEDED';
  switch (fix.kind) {
    case 'hold': return 'HOLD POSITION';
    case 'slow': return `SLOW TO ${fix.slowKnots} KNOTS`;
    case 'stepAside': return `STEP ASIDE ${compassWord(fix.asideToward ?? 0)} ${fix.asideMeters} m`;
    case 'reroute': return `ALTER COURSE ${compassWord(fix.asideToward ?? 0)} ${fix.asideMeters} m`;
  }
}
