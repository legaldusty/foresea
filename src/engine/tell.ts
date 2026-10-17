import { distanceField, type Grid } from './grid';
import { defaultSettings, type Settings } from './settings';

export const LOST = -1;
export const DRIFT = -2;
export const LOST_NAME = 'Lost / wandering';
export const DRIFT_NAME = 'Drifting with the current';

const NO_STREAK = -3;
const UNREACHABLE_LIKELIHOOD = 1e-6;
const UNDERFLOW_GUARD = 1e-300;
const PREDICTED_PATH_MAX_STEPS = 2000;

export interface TellTarget {
  cell: number;
  name: string;
  id?: string;
}

export interface CurrentVector {
  currentU: number;
  currentV: number;
}

export interface MoveContext {
  currentU?: number;
  currentV?: number;
  contactSpeedMps?: number;
}

export interface TellOptions {
  beta: number;
  lostPrior: number;
  forget: number;
  callAt: number;
  callSteps: number;
  nearnessPower: number;
  driftPrior: number;
  driftToleranceMps: number;
  driftSharpness: number;
  driftSpeedFalloffMps: number;
  evasiveMinProgressCells: number;
}

export interface TellCreateOptions extends Partial<TellOptions> {
  current?: CurrentVector | null;
  fields?: Float32Array[];
}

export interface TellCall {
  goal: number;
  step: number;
  odds: number;
  remainingCells: number;
}

export interface TellState<T extends TellTarget = TellTarget> {
  grid: Grid;
  targets: T[];
  fields: Float32Array[];
  options: TellOptions;
  prior: Float64Array;
  post: Float64Array;
  current: CurrentVector | null;
  steps: number;
  streak: number;
  streakGoal: number;
  call: TellCall | null;
  pathCells: number;
}

export interface GoalOdds {
  goal: number;
  p: number;
}

export interface OddsEntry extends GoalOdds {
  name: string;
  id?: string;
}

export function tellDefaults(settings: Settings = defaultSettings): TellOptions {
  const t = settings.tell;
  return {
    beta: t.beta,
    lostPrior: t.lostPrior,
    forget: t.forget,
    callAt: t.callAt,
    callSteps: t.callSteps,
    nearnessPower: t.nearnessPower,
    driftPrior: t.driftPrior,
    driftToleranceMps: t.driftToleranceMps,
    driftSharpness: t.driftSharpness,
    driftSpeedFalloffMps: t.driftSpeedFalloffMps,
    evasiveMinProgressCells: t.evasiveMinProgressCells,
  };
}

export function lostIndex(T: TellState): number {
  return T.fields.length;
}

export function driftIndex(T: TellState): number {
  return T.fields.length + 1;
}

export function isTargetGoal(goal: number): boolean {
  return goal >= 0;
}

function initialPrior(targetCount: number, options: TellOptions, withDrift: boolean): Float64Array {
  const prior = new Float64Array(targetCount + 2);
  const driftPrior = withDrift ? options.driftPrior : 0;
  for (let k = 0; k < targetCount; k++) prior[k] = (1 - options.lostPrior - driftPrior) / targetCount;
  prior[targetCount] = options.lostPrior;
  prior[targetCount + 1] = driftPrior;
  return prior;
}

export function createTell<T extends TellTarget>(grid: Grid, targets: T[], input: TellCreateOptions = {}): TellState<T> {
  const { current = null, fields: givenFields, ...overrides } = input;
  const options: TellOptions = { ...tellDefaults(), ...overrides };
  const fields = givenFields ?? targets.map((t) => distanceField(grid, t.cell));
  const prior = initialPrior(targets.length, options, current !== null);
  return {
    grid, targets, fields, options, prior, current,
    post: Float64Array.from(prior),
    steps: 0, streak: 0, streakGoal: NO_STREAK,
    call: null,
    pathCells: 0,
  };
}

export function resetTell(T: TellState): void {
  T.post = Float64Array.from(T.prior);
  T.steps = 0;
  T.streak = 0;
  T.streakGoal = NO_STREAK;
  T.call = null;
  T.pathCells = 0;
}

export function hasDriftHypothesis(T: TellState): boolean {
  return T.prior[driftIndex(T)] > 0;
}

export function proximityPrior(T: TellState, startCell: number, power: number = T.options.nearnessPower): void {
  const n = T.fields.length;
  const lost = T.prior[n];
  const drift = T.prior[n + 1];
  const distances = T.fields.map((D) => D[startCell]);
  const dmin = Math.min(...distances);
  const weights = distances.map((d) => nearnessWeight(dmin, d, power));
  const s = weights.reduce((a, b) => a + b, 0);
  for (let g = 0; g < n; g++) T.prior[g] = (1 - lost - drift) * weights[g] / s;
  T.post = Float64Array.from(T.prior);
}

function nearnessWeight(dmin: number, d: number, power: number): number {
  if (dmin === 0) return d === 0 ? 1 : 0;
  return Math.pow(dmin / d, power);
}

function stepCost(nb: number[], b: number): number {
  for (let k = 0; k < nb.length; k += 2) if (nb[k] === b) return nb[k + 1];
  return 1;
}

function targetMoveLikelihood(D: Float32Array, nb: number[], a: number, b: number, beta: number): number {
  const Da = D[a];
  if (!isFinite(Da)) return UNREACHABLE_LIKELIHOOD;
  let Z = 0;
  let num = 0;
  for (let k = 0; k < nb.length; k += 2) {
    const adv = Da - (nb[k + 1] + D[nb[k]]);
    const w = Math.exp(beta * adv);
    Z += w;
    if (nb[k] === b) num = w;
  }
  return Z > 0 ? num / Z : UNREACHABLE_LIKELIHOOD;
}

export function currentInGrid(current: CurrentVector): [number, number] {
  return [current.currentU, -current.currentV];
}

export function currentSpeed(current: CurrentVector): number {
  return Math.hypot(current.currentU, current.currentV);
}

function driftDirectionLikelihood(grid: Grid, a: number, b: number, current: CurrentVector, sharpness: number): number {
  const nb = grid.neighbors[a];
  const m = nb.length / 2 || 1;
  const speed = currentSpeed(current);
  if (speed === 0) return 1 / m;
  const [gx, gy] = currentInGrid(current);
  const ux = gx / speed;
  const uy = gy / speed;
  const [x, y] = grid.xy(a);
  let Z = 0;
  let num = 0;
  for (let k = 0; k < nb.length; k += 2) {
    const [X, Y] = grid.xy(nb[k]);
    const dx = X - x;
    const dy = Y - y;
    const cosine = (dx * ux + dy * uy) / Math.hypot(dx, dy);
    const w = Math.exp(sharpness * cosine);
    Z += w;
    if (nb[k] === b) num = w;
  }
  return Z > 0 ? num / Z : UNREACHABLE_LIKELIHOOD;
}

export function speedConsistency(contactSpeedMps: number, currentSpeedMps: number, toleranceMps: number, falloffMps: number): number {
  const excess = Math.abs(contactSpeedMps - currentSpeedMps) - toleranceMps;
  if (excess <= 0) return 1;
  return Math.exp(-(excess * excess) / (2 * falloffMps * falloffMps));
}

function resolveCurrent(T: TellState, context: MoveContext): CurrentVector | null {
  const u = context.currentU ?? T.current?.currentU;
  const v = context.currentV ?? T.current?.currentV;
  if (u === undefined || v === undefined) return null;
  return { currentU: u, currentV: v };
}

export function driftMoveLikelihood(T: TellState, a: number, b: number, context: MoveContext = {}): number {
  const current = resolveCurrent(T, context);
  if (!current) return UNREACHABLE_LIKELIHOOD;
  const o = T.options;
  const directional = driftDirectionLikelihood(T.grid, a, b, current, o.driftSharpness);
  if (context.contactSpeedMps === undefined) return directional;
  return directional * speedConsistency(context.contactSpeedMps, currentSpeed(current), o.driftToleranceMps, o.driftSpeedFalloffMps);
}

function forgetTowardPrior(post: Float64Array, prior: Float64Array, forget: number): void {
  let s = 0;
  for (let g = 0; g < post.length; g++) {
    post[g] = Math.pow(post[g] + UNDERFLOW_GUARD, 1 - forget) * Math.pow(prior[g], forget);
    s += post[g];
  }
  for (let g = 0; g < post.length; g++) post[g] /= s;
}

function updateCall(T: TellState, b: number): void {
  const o = T.options;
  const best = topGoal(T);
  if (isTargetGoal(best.goal) && best.p >= o.callAt) {
    T.streak = best.goal === T.streakGoal ? T.streak + 1 : 1;
    T.streakGoal = best.goal;
    if (T.streak >= o.callSteps && (!T.call || T.call.goal !== best.goal)) {
      T.call = { goal: best.goal, step: T.steps, odds: best.p, remainingCells: T.fields[best.goal][b] };
    }
  } else {
    T.streak = 0;
    T.streakGoal = NO_STREAK;
  }
}

export function observe<T extends TellState>(T: T, a: number, b: number, context: MoveContext = {}): T {
  const { grid, fields, options: o, post, prior } = T;
  const nb = grid.neighbors[a];
  const n = fields.length;
  const moveCost = stepCost(nb, b);
  const m = nb.length / 2 || 1;

  for (let g = 0; g < n; g++) post[g] *= targetMoveLikelihood(fields[g], nb, a, b, o.beta);
  post[n] *= 1 / m;
  if (hasDriftHypothesis(T)) post[n + 1] *= driftMoveLikelihood(T, a, b, context);

  forgetTowardPrior(post, prior, o.forget);

  T.steps++;
  T.pathCells += moveCost;
  updateCall(T, b);
  return T;
}

export function odds(T: TellState): OddsEntry[] {
  const n = T.fields.length;
  const out: OddsEntry[] = T.targets.map((t, g) => ({ goal: g, name: t.name, id: t.id, p: T.post[g] }));
  out.push({ goal: LOST, name: LOST_NAME, p: T.post[n] });
  out.push({ goal: DRIFT, name: DRIFT_NAME, p: T.post[n + 1] });
  return out.sort((a, b) => b.p - a.p);
}

export function targetOdds(T: TellState): number[] {
  return Array.from(T.post.subarray(0, T.fields.length));
}

export function lostOnlyOdds(T: TellState): number {
  return T.post[lostIndex(T)];
}

export function driftOdds(T: TellState): number {
  return T.post[driftIndex(T)];
}

export function lostOdds(T: TellState): number {
  return T.post[lostIndex(T)] + T.post[driftIndex(T)];
}

export function topGoal(T: Pick<TellState, 'fields' | 'post'>): GoalOdds {
  const n = T.fields.length;
  let goal = LOST;
  let p = T.post[n];
  for (let g = 0; g < n; g++) if (T.post[g] > p) { p = T.post[g]; goal = g; }
  const drift = T.post[n + 1] ?? 0;
  if (drift > p) { p = drift; goal = DRIFT; }
  return { goal, p };
}

function activeHypotheses(T: TellState): number {
  return hasDriftHypothesis(T) ? T.fields.length + 2 : T.fields.length + 1;
}

export function uncertainty(T: TellState): number {
  let H = 0;
  for (const p of T.post) if (p > 0) H -= p * Math.log(p);
  return H / Math.log(activeHypotheses(T));
}

export function predictedPath(T: Pick<TellState, 'fields' | 'grid'>, goal: number, cell: number, maxSteps = PREDICTED_PATH_MAX_STEPS): number[] {
  const D = T.fields[goal];
  const nb = T.grid.neighbors;
  const out = [cell];
  let i = cell;
  for (let s = 0; s < maxSteps && D[i] > 0; s++) {
    let best = -1;
    let bd = D[i];
    for (let k = 0; k < nb[i].length; k += 2) {
      const j = nb[i][k];
      if (D[j] < bd) { bd = D[j]; best = j; }
    }
    if (best < 0) break;
    out.push(best);
    i = best;
  }
  return out;
}

export function evasiveness(T: TellState, startCell: number, cell: number): number {
  const { goal } = topGoal(T);
  if (!isTargetGoal(goal)) return 1;
  const D = T.fields[goal];
  const progress = D[startCell] - D[cell];
  return progress > T.options.evasiveMinProgressCells ? T.pathCells / progress : 1;
}
