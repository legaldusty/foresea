import type { Harbor } from './harbor';
import type { Settings } from './settings';
import { findPath } from './grid';
import {
  createTell, observe, odds as tellOdds, topGoal, predictedPath, evasiveness, lostOdds, proximityPrior, tellDefaults,
  LOST, DRIFT, type TellState, type CurrentVector,
} from './tell';
import {
  classify, capability, sizeFactor, speedFactor, hostility, createLoiterClock, cellsToNearest, isSecurityKind, evidenceCells,
  type Heat, type ReplyStatus, type Classification, type Hostility, type LoiterClock,
} from './identify';
import { createRiskTracker, type RiskTracker, type RiskExplanation } from './risk';
import { rng } from './bench';
import type { Leg } from './scenarios';
import { bearingDeg, lerpLonLat, type LonLat } from './geo';

export type ContactMode = 'driven' | 'bot' | 'scenario' | 'drift' | 'wander';

export interface ContactSpec {
  id: string;
  label: string;
  mode: ContactMode;
  scenarioKey?: string | null;
  startCell: number;
  sizeM: number;
  speedMps: number;
  heat: Heat;
  erratic?: boolean;
  reply: ReplyStatus;
  registryId?: string | null;
  planFiled?: boolean;
  plan?: Leg[];
  seed: number;
  driftDir?: [number, number];
  currentOverride?: CurrentVector | null;
  firstSeenMin: number;
}

export interface ContactSim {
  spec: ContactSpec;
  id: string;
  cell: number;
  nextCell: number | null;
  progressM: number;
  headingDeg: number;
  tell: TellState;
  risk: RiskTracker;
  loiter: LoiterClock;
  rand: () => number;
  legIdx: number;
  legStartMin: number;
  pointer: number | null;
  queue: number[];
  track: number[];
  arrived: boolean;
  silent: boolean;
  silentSinceMin: number | null;
  lastSeenMin: number;
  classification: Classification;
  hostility: Hostility | null;
  K: number;
  lastRisk: RiskExplanation | null;
  callSinceMin: number | null;
  callGoal: number | null;
  pings: number;
  lastEvalMin: number;
  steps: number;
}

export interface EvalContext {
  t: number;
  night: boolean;
  current: CurrentVector | null;
  currentSpeedMps: number;
  cruiseDocked: boolean;
  coordinatedCount: number;
}

const ARRIVE_CELLS = 1.5;

export function createContact(h: Harbor, settings: Settings, spec: ContactSpec, current: CurrentVector | null, nearness: boolean): ContactSim {
  const effectiveCurrent = spec.currentOverride !== undefined ? spec.currentOverride : current;
  const tell = createTell(h.grid, h.targets, { ...tellDefaults(settings), fields: h.fields, current: effectiveCurrent });
  if (nearness) proximityPrior(tell, spec.startCell, settings.tell.nearnessPower);
  return {
    spec,
    id: spec.id,
    cell: spec.startCell,
    nextCell: null,
    progressM: 0,
    headingDeg: 0,
    tell,
    risk: createRiskTracker(settings),
    loiter: createLoiterClock(),
    rand: rng(spec.seed),
    legIdx: 0,
    legStartMin: spec.firstSeenMin,
    pointer: null,
    queue: [],
    track: [spec.startCell],
    arrived: false,
    silent: false,
    silentSinceMin: null,
    lastSeenMin: spec.firstSeenMin,
    classification: classify({ speedMps: spec.speedMps, heat: spec.heat, sizeM: spec.sizeM, erratic: spec.erratic }, settings),
    hostility: null,
    K: 0,
    lastRisk: null,
    callSinceMin: null,
    callGoal: null,
    pings: 0,
    lastEvalMin: -Infinity,
    steps: 0,
  };
}

function stepToward(h: Harbor, D: Float32Array, cell: number, rand: () => number, sloppy: number, noise: number): number {
  const nb = h.grid.neighbors[cell];
  let best = -1, bs = Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const s = nb[k + 1] + D[nb[k]] + sloppy * noise * rand();
    if (s < bs) { bs = s; best = nb[k]; }
  }
  return best;
}

function stepDrift(h: Harbor, cell: number, rand: () => number, dir: [number, number], noise: number): number {
  const nb = h.grid.neighbors[cell];
  const [x, y] = h.grid.xy(cell);
  let best = -1, bs = -Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const [X, Y] = h.grid.xy(nb[k]);
    const s = (X - x) * dir[0] + (Y - y) * dir[1] + noise * rand();
    if (s > bs) { bs = s; best = nb[k]; }
  }
  return best;
}

function stepWander(h: Harbor, c: ContactSim): number {
  const nb = h.grid.neighbors[c.cell];
  if (!nb.length) return -1;
  const [x, y] = h.grid.xy(c.cell);
  const rad = (c.headingDeg * Math.PI) / 180;
  const dir: [number, number] = [Math.sin(rad), -Math.cos(rad)];
  let best = -1, bs = -Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const [X, Y] = h.grid.xy(nb[k]);
    const s = (X - x) * dir[0] + (Y - y) * dir[1] + 2.4 * c.rand();
    if (s > bs) { bs = s; best = nb[k]; }
  }
  return best;
}

function chooseNext(h: Harbor, settings: Settings, c: ContactSim, t: number): number | null {
  const spec = c.spec;
  if (spec.mode === 'driven') {
    if (c.pointer === null || c.pointer === c.cell) return null;
    if (!c.queue.length || c.queue[c.queue.length - 1] !== c.pointer) {
      const path = findPath(h.grid, c.cell, c.pointer);
      c.queue = path ? path.slice(1) : [];
    }
    return c.queue.shift() ?? null;
  }
  if (spec.mode === 'wander') return stepWander(h, c);
  const plan = spec.plan ?? [];
  while (c.legIdx < plan.length) {
    const leg = plan[c.legIdx];
    if ('drift' in leg) {
      if (t - c.legStartMin >= leg.minutes) { c.legIdx++; c.legStartMin = t; continue; }
      return stepDrift(h, c.cell, c.rand, leg.drift, settings.scenarios.driftNoise);
    }
    const g = h.targets.findIndex((tg) => tg.id === leg.goal);
    const D = h.fields[g];
    if (D[c.cell] <= (leg.untilNear ?? ARRIVE_CELLS)) { c.legIdx++; c.legStartMin = t; continue; }
    return stepToward(h, D, c.cell, c.rand, leg.sloppy, settings.scenarios.towardNoise);
  }
  if (spec.mode === 'drift' && spec.driftDir) return stepDrift(h, c.cell, c.rand, spec.driftDir, settings.scenarios.driftNoise);
  c.arrived = true;
  return null;
}

export function contactLonLat(h: Harbor, c: ContactSim): LonLat {
  const here = h.grid.toLonLat(...h.grid.xy(c.cell)) as LonLat;
  if (c.nextCell === null) return here;
  const there = h.grid.toLonLat(...h.grid.xy(c.nextCell)) as LonLat;
  return lerpLonLat(here, there, Math.min(1, c.progressM / h.grid.cellMeters));
}

export function moveContact(h: Harbor, settings: Settings, c: ContactSim, dtSec: number, t: number, ctx: EvalContext, onStep: () => void): void {
  if (c.silent) return;
  c.lastSeenMin = t;
  if (c.nextCell === null) {
    c.nextCell = chooseNext(h, settings, c, t);
    c.progressM = 0;
    if (c.nextCell === null || c.nextCell < 0) { c.nextCell = null; return; }
  }
  c.progressM += c.spec.speedMps * dtSec;
  const stepM = h.grid.cellMeters;
  let guard = 0;
  while (c.nextCell !== null && c.progressM >= stepM && guard++ < 50) {
    const from = c.cell, to = c.nextCell;
    const current = c.spec.currentOverride !== undefined ? c.spec.currentOverride : ctx.current;
    observe(c.tell, from, to, current ? { ...current, contactSpeedMps: c.spec.speedMps } : {});
    c.headingDeg = bearingDeg(h.grid.toLonLat(...h.grid.xy(from)) as LonLat, h.grid.toLonLat(...h.grid.xy(to)) as LonLat);
    c.cell = to;
    c.steps++;
    c.track.push(to);
    if (c.track.length > 400) c.track.shift();
    c.progressM -= stepM;
    onStep();
    const next = chooseNext(h, settings, c, t);
    c.nextCell = next !== null && next >= 0 ? next : null;
    if (c.nextCell === null) c.progressM = 0;
  }
}

export function etaToGoal(h: Harbor, c: ContactSim, goal: number): number | null {
  if (goal < 0 || c.spec.speedMps <= 0) return null;
  const cells = h.fields[goal][c.cell];
  return isFinite(cells) ? (cells * h.grid.cellMeters) / c.spec.speedMps / 60 : null;
}

export function evaluateContact(h: Harbor, settings: Settings, c: ContactSim, ctx: EvalContext): void {
  c.lastEvalMin = ctx.t;
  const reading = { speedMps: c.spec.speedMps, heat: c.spec.heat, sizeM: c.spec.sizeM, erratic: c.spec.erratic, currentSpeedMps: ctx.currentSpeedMps };
  c.classification = classify(reading, settings);
  c.K = capability(c.spec.sizeM, c.spec.speedMps, c.classification.powered, settings);
  if (!c.classification.threatScored) { c.hostility = null; c.lastRisk = null; return; }
  if (c.silent) return;
  const T = c.tell;
  const top = topGoal(T);
  const lost = lostOdds(T);
  const cells = evidenceCells(h.grid.cellMeters, settings);
  const nearTarget = cellsToNearest(h.fields, c.cell) <= cells.loiterCells;
  const loiterMin = c.loiter.update(ctx.t, nearTarget);
  const secCells = cellsToNearest(h.fields, c.cell, (g) => isSecurityKind(h.targets[g].kind, settings));
  const registered = c.spec.registryId ? h.registry.find((r) => r.id === c.spec.registryId) : undefined;
  c.hostility = hostility({
    reply: c.spec.reply,
    minutesSinceDetected: ctx.t - c.spec.firstSeenMin,
    steps: T.steps,
    lostOdds: lost,
    evasiveRatio: evasiveness(T, c.spec.startCell, c.cell),
    minutesNearTarget: loiterMin,
    cellsToSecurityTarget: secCells,
    night: ctx.night,
    cellMeters: h.grid.cellMeters,
    planFiled: c.spec.planFiled || !!registered?.divePlan,
    debris: c.classification.kind === 'debris',
    coordinatedCount: ctx.coordinatedCount,
  }, settings);
  const etaTopMin = top.goal >= 0 ? etaToGoal(h, c, top.goal) : null;
  c.lastRisk = c.risk.update({
    t: ctx.t,
    H: c.hostility.H,
    K: c.K,
    targets: h.targets.map((tg, g) => ({ id: tg.id, odds: T.post[g] })),
    top,
    etaTopMin,
    cruiseDocked: ctx.cruiseDocked,
    ambient: c.spec.heat === 'ambient',
    friendly: c.spec.reply === 'friendly',
  });
  const call = T.call;
  if (call && call.goal !== c.callGoal) { c.callGoal = call.goal; c.callSinceMin = ctx.t; }
  if (!call) { c.callGoal = null; c.callSinceMin = null; }
}

export function topTargets(h: Harbor, c: ContactSim, count: number, minOdds = 0.05): { goal: number; p: number }[] {
  const n = h.targets.length;
  const list: { goal: number; p: number }[] = [];
  for (let g = 0; g < n; g++) list.push({ goal: g, p: c.tell.post[g] });
  return list.sort((a, b) => b.p - a.p).slice(0, count).filter((x) => x.p >= minOdds);
}

export function predictedPaths(h: Harbor, c: ContactSim, count: number): number[][] {
  return topTargets(h, c, count).map((t) => predictedPath(c.tell, t.goal, c.cell));
}

export function oddsRows(c: ContactSim): { id: string; name: string; p: number; kind: 'target' | 'lost' | 'drift' }[] {
  return tellOdds(c.tell)
    .filter((o) => o.goal !== DRIFT || c.tell.current !== null)
    .map((o) => ({
      id: o.goal === LOST ? 'lost' : o.goal === DRIFT ? 'drift' : String(o.id),
      name: o.name,
      p: o.p,
      kind: o.goal === LOST ? 'lost' : o.goal === DRIFT ? 'drift' : 'target',
    }));
}

export function setPointer(h: Harbor, c: ContactSim, cell: number | null): void {
  c.pointer = cell;
  c.queue = [];
}

export function factors(settings: Settings, c: ContactSim): { sizeFactor: number; speedFactor: number } {
  return { sizeFactor: sizeFactor(c.spec.sizeM, settings), speedFactor: speedFactor(c.spec.speedMps, c.classification.powered, settings) };
}
