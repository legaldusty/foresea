import type { Grid } from './grid';
import type { Harbor } from './harbor';
import { defaultSettings, type Settings } from './settings';
import { createTell, observe, predictedPath, proximityPrior, resetTell, type TellCreateOptions, type TellState } from './tell';

const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;
const PROGRESS_EVERY_NIGHTS = 50;
const SECONDS_PER_MINUTE = 60;

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + MULBERRY_INCREMENT) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export type StyleName = 'direct' | 'sloppy' | 'decoy';

export interface IntruderStyle {
  sloppy: number;
  decoy: boolean;
}

export const STYLES: Record<StyleName, IntruderStyle> = defaultSettings.bench.styles;

export type Detection = 'gates' | 'closeIn';

export interface BenchStep {
  night: number;
  style: StyleName;
  goal: number;
  from: number;
  to: number;
  tell: TellState;
}

export type BenchStepListener = (step: BenchStep) => void;

export interface BenchOptions {
  nights?: number;
  seed?: number;
  speedMps?: number;
  tellOpts?: TellCreateOptions;
  nearness?: boolean;
  detection?: Detection;
  settings?: Settings;
  onProgress?: (fraction: number) => void;
  onStep?: BenchStepListener;
}

export interface BenchNight {
  style: StyleName;
  goal: number;
  tellMin: number;
  baseMin: number;
  tellCorrect: boolean;
  wrongCalls: number;
  totalMin: number;
}

export interface BenchGroup {
  nights: number;
  tellWarnMin: number;
  baseWarnMin: number;
  tellCalledRight: number;
  wrongCallsPerNight: number;
  tripMin: number;
}

export interface BenchSummary {
  all: BenchGroup;
  direct: BenchGroup;
  sloppy: BenchGroup;
  decoy: BenchGroup;
}

type BenchSettings = Settings['bench'];

function stepToward(grid: Grid, D: Float32Array, cell: number, rand: () => number, sloppy: number, noise: number): number {
  const nb = grid.neighbors[cell];
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k < nb.length; k += 2) {
    const j = nb[k];
    const score = nb[k + 1] + D[j] + sloppy * noise * rand();
    if (score < bestScore) { bestScore = score; best = j; }
  }
  return best;
}

function closeInStart(grid: Grid, D: Float32Array, spawn: number, rand: () => number, b: BenchSettings): number {
  const minCells = b.closeInMinMeters / grid.cellMeters;
  const maxCells = b.closeInMaxMeters / grid.cellMeters;
  const wanted = minCells + (maxCells - minCells) * rand();
  const route = predictedPath({ fields: [D], grid }, 0, spawn);
  for (const cell of route) if (D[cell] <= wanted) return cell;
  return route[route.length - 1];
}

function nearestTarget(fields: Float32Array[], cell: number): number {
  let nearest = 0;
  let nd = Infinity;
  for (let g = 0; g < fields.length; g++) if (fields[g][cell] < nd) { nd = fields[g][cell]; nearest = g; }
  return nearest;
}

interface NightPlan {
  style: StyleName;
  S: IntruderStyle;
  goal: number;
  start: number;
  decoyGoal: number;
  decoyUntil: number;
}

function planNight(h: Harbor, T: TellState, n: number, rand: () => number, styles: Record<StyleName, IntruderStyle>, detection: Detection, b: BenchSettings): NightPlan {
  const styleNames = Object.keys(styles) as StyleName[];
  const style = styleNames[n % styleNames.length];
  const S = styles[style];
  const goal = Math.floor(rand() * h.targets.length);
  const spawn = h.spawns[Math.floor(rand() * h.spawns.length)].cell;
  let decoyGoal = -1;
  let decoyUntil = 0;
  if (S.decoy) {
    do { decoyGoal = Math.floor(rand() * h.targets.length); } while (decoyGoal === goal);
    decoyUntil = b.decoyStartFraction + b.decoySpanFraction * rand();
  }
  const start = detection === 'closeIn' ? closeInStart(h.grid, T.fields[goal], spawn, rand, b) : spawn;
  return { style, S, goal, start, decoyGoal, decoyUntil };
}

function runNight(h: Harbor, T: TellState, plan: NightPlan, rand: () => number, speedMps: number, nearness: boolean, b: BenchSettings, night: number, onStep: BenchStepListener | undefined): BenchNight {
  const { style, S, goal, start, decoyGoal, decoyUntil } = plan;
  const cellM = h.grid.cellMeters;
  const Dtrue = T.fields[goal];
  const total = Dtrue[start];
  resetTell(T);
  if (nearness) proximityPrior(T, start);
  let cell = start;
  let guard = 0;
  let decoyDone = !S.decoy;
  let tellRightFrom: number | null = null;
  let tellWrongCalls = 0;
  let lastCall = null as TellState['call'];
  let baseRightFrom: number | null = null;
  while (Dtrue[cell] > b.arriveCells && guard++ < b.maxSteps) {
    if (!decoyDone && (T.fields[decoyGoal][cell] <= b.decoyReachCells || guard > decoyUntil * total * b.decoyStretch)) decoyDone = true;
    const D = decoyDone ? Dtrue : T.fields[decoyGoal];
    const next = stepToward(h.grid, D, cell, rand, S.sloppy, b.stepNoise);
    if (next < 0) break;
    observe(T, cell, next);
    if (onStep) onStep({ night, style, goal, from: cell, to: next, tell: T });
    cell = next;
    if (T.call && T.call !== lastCall) { lastCall = T.call; if (T.call.goal !== goal) tellWrongCalls++; }
    const tellRight = T.call !== null && T.call.goal === goal;
    if (tellRight && tellRightFrom === null) tellRightFrom = Dtrue[cell];
    if (!tellRight) tellRightFrom = null;
    if (nearestTarget(T.fields, cell) === goal) { if (baseRightFrom === null) baseRightFrom = Dtrue[cell]; } else baseRightFrom = null;
  }
  const toMin = (cells: number | null) => cells === null ? 0 : (cells * cellM) / speedMps / SECONDS_PER_MINUTE;
  return {
    style, goal,
    tellMin: toMin(tellRightFrom), baseMin: toMin(baseRightFrom),
    tellCorrect: tellRightFrom !== null, wrongCalls: tellWrongCalls, totalMin: toMin(total),
  };
}

export function runNightsDetailed(h: Harbor, options: BenchOptions = {}): BenchNight[] {
  const settings = options.settings ?? defaultSettings;
  const b = settings.bench;
  const nights = options.nights ?? b.nights;
  const speedMps = options.speedMps ?? b.speedMps;
  const detection = options.detection ?? 'gates';
  const nearness = options.nearness ?? false;
  const styles = b.styles as Record<StyleName, IntruderStyle>;
  const rand = rng(options.seed ?? b.seed);
  const T = createTell(h.grid, h.targets, { fields: h.fields, ...options.tellOpts });
  const res: BenchNight[] = [];
  for (let n = 0; n < nights; n++) {
    const plan = planNight(h, T, n, rand, styles, detection, b);
    res.push(runNight(h, T, plan, rand, speedMps, nearness, b, n, options.onStep));
    if (options.onProgress && n % PROGRESS_EVERY_NIGHTS === 0) options.onProgress(n / nights);
  }
  return res;
}

export function runNights(h: Harbor, options: BenchOptions = {}): BenchSummary {
  return summarize(runNightsDetailed(h, options));
}

function average(values: number[]): number {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 0;
}

function group(res: BenchNight[], filter: (x: BenchNight) => boolean): BenchGroup {
  const r = res.filter(filter);
  return {
    nights: r.length,
    tellWarnMin: average(r.map((x) => x.tellMin)),
    baseWarnMin: average(r.map((x) => x.baseMin)),
    tellCalledRight: r.filter((x) => x.tellCorrect).length / (r.length || 1),
    wrongCallsPerNight: average(r.map((x) => x.wrongCalls)),
    tripMin: average(r.map((x) => x.totalMin)),
  };
}

export function summarize(res: BenchNight[]): BenchSummary {
  return {
    all: group(res, () => true),
    direct: group(res, (x) => x.style === 'direct'),
    sloppy: group(res, (x) => x.style === 'sloppy'),
    decoy: group(res, (x) => x.style === 'decoy'),
  };
}

export interface BenchAcceptance {
  warningRatio: number;
  rightByArrival: number;
  minWarningRatio: number;
  minRightByArrival: number;
  passes: boolean;
}

export function benchAcceptance(gateSummary: BenchSummary, settings: Settings = defaultSettings): BenchAcceptance {
  const bar = settings.bench.acceptance;
  const all = gateSummary.all;
  const warningRatio = all.baseWarnMin > 0 ? all.tellWarnMin / all.baseWarnMin : Infinity;
  const rightByArrival = all.tellCalledRight;
  return {
    warningRatio, rightByArrival,
    minWarningRatio: bar.minWarningRatio, minRightByArrival: bar.minRightByArrival,
    passes: warningRatio >= bar.minWarningRatio && rightByArrival >= bar.minRightByArrival,
  };
}
