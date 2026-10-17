import { contours } from 'd3-contour';
import type { Grid } from './grid';
import type { LonLat } from './geo';
import { rng } from './bench';

export interface ForecastOptions {
  samples: number;
  beta: number;
  lostBeta: number;
  driftSharpness: number;
  speedSpread: number;
  horizonMinutes: number;
  radiusCells: number;
  radiusGrowMinutes: number;
  radiusMaxCells: number;
  likelyShare: number;
  likelyMaxRadiusCells: number;
  carefulShare: number;
  tickMinutes: number;
  seed: number;
}

export const FORECAST_DEFAULTS: ForecastOptions = {
  samples: 600,
  beta: 3,
  lostBeta: 0.6,
  driftSharpness: 3,
  speedSpread: 0.15,
  horizonMinutes: 90,
  radiusCells: 2,
  radiusGrowMinutes: 15,
  radiusMaxCells: 6,
  likelyShare: 0.5,
  likelyMaxRadiusCells: 9,
  carefulShare: 0.125,
  tickMinutes: 10,
  seed: 11,
};

export interface ForecastCurrent {
  eastMps: number;
  northMps: number;
}

export interface ForecastInput {
  cell: number;
  speedMps: number;
  targetOdds: number[];
  lost: number;
  drift: number;
  current: ForecastCurrent | null;
}

export interface ForecastTick {
  minutes: number;
  cell: number;
}

export interface ArrivalWindow {
  target: number;
  share: number;
  early: number;
  median: number;
  late: number;
}

export interface Forecast {
  samples: number;
  topTarget: number;
  passShare: Float32Array;
  likely: Uint8Array;
  timeEarly: Float32Array;
  timeLate: Float32Array;
  ticks: ForecastTick[];
  arrival: ArrivalWindow | null;
}

export type ForecastLayer = 'likely' | 'careful';

export interface ForecastShapes {
  likely: LonLat[][][];
  careful: LonLat[][][];
}

export interface CellCrossing {
  layer: ForecastLayer | null;
  early: number;
  late: number;
}

const DRIFT_HYPOTHESIS = -2;
const LOST_HYPOTHESIS = -1;
const MAX_STEPS = 6000;
const ARRIVED_CELLS = 0.5;
const Z_WINDOW = 1.2816;

type Disk = [number, number][];

function makeDisks(maxRadius: number): Disk[] {
  const disks: Disk[] = [];
  for (let r = 0; r <= maxRadius; r++) {
    const d: Disk = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) d.push([dx, dy]);
    disks.push(d);
  }
  return disks;
}

function pickHypothesis(input: ForecastInput, u: number): number {
  const total = input.targetOdds.reduce((a, b) => a + b, 0) + input.lost + input.drift;
  let acc = 0;
  for (let g = 0; g < input.targetOdds.length; g++) {
    acc += input.targetOdds[g] / total;
    if (u <= acc) return g;
  }
  acc += input.lost / total;
  if (u <= acc) return LOST_HYPOTHESIS;
  return input.current ? DRIFT_HYPOTHESIS : LOST_HYPOTHESIS;
}

function boltzmannStep(grid: Grid, D: Float32Array, i: number, beta: number, rand: () => number): [number, number] {
  const nb = grid.neighbors[i];
  let Z = 0;
  const w: number[] = [];
  for (let k = 0; k < nb.length; k += 2) {
    const x = Math.exp(beta * (D[i] - (nb[k + 1] + D[nb[k]])));
    w.push(x);
    Z += x;
  }
  let u = rand() * Z;
  for (let k = 0; k < w.length; k++) {
    u -= w[k];
    if (u <= 0) return [nb[2 * k], nb[2 * k + 1]];
  }
  return [nb[nb.length - 2], nb[nb.length - 1]];
}

function driftStep(grid: Grid, current: ForecastCurrent, i: number, sharpness: number, rand: () => number): [number, number] {
  const nb = grid.neighbors[i];
  const speed = Math.hypot(current.eastMps, current.northMps) || 1;
  const ux = current.eastMps / speed;
  const uy = -current.northMps / speed;
  const [x, y] = grid.xy(i);
  let Z = 0;
  const w: number[] = [];
  for (let k = 0; k < nb.length; k += 2) {
    const [X, Y] = grid.xy(nb[k]);
    const dx = X - x;
    const dy = Y - y;
    const v = Math.exp(sharpness * ((dx * ux + dy * uy) / Math.hypot(dx, dy)));
    w.push(v);
    Z += v;
  }
  let u = rand() * Z;
  for (let k = 0; k < w.length; k++) {
    u -= w[k];
    if (u <= 0) return [nb[2 * k], nb[2 * k + 1]];
  }
  return [nb[nb.length - 2], nb[nb.length - 1]];
}

function medoid(grid: Grid, cells: number[]): [number, number] {
  let mx = 0;
  let my = 0;
  const pts = cells.map((c) => grid.xy(c));
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length;
  my /= pts.length;
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];
}

export function forecastPaths(grid: Grid, fields: Float32Array[], input: ForecastInput, overrides: Partial<ForecastOptions> = {}): Forecast {
  const o: ForecastOptions = { ...FORECAST_DEFAULTS, ...overrides };
  const rand = rng(o.seed);
  const size = grid.nx * grid.ny;
  const N = o.samples;
  const horizon = o.horizonMinutes * 60;
  const disks = makeDisks(o.radiusMaxCells);
  const count = new Uint16Array(size);
  const stamp = new Int32Array(size).fill(-1);
  const tMin = new Float32Array(size).fill(Infinity);
  const tMax = new Float32Array(size);
  const tSum = new Float64Array(size);
  const tSq = new Float64Array(size);
  let topTarget = 0;
  for (let g = 1; g < input.targetOdds.length; g++) if (input.targetOdds[g] > input.targetOdds[topTarget]) topTarget = g;
  const bucketSeconds = Math.min(60, Math.max(10, (1.5 * grid.cellMeters) / Math.max(0.05, input.speedMps)));
  const buckets = Math.ceil(horizon / bucketSeconds);
  const positions: Int32Array[] = [];
  const isTop: boolean[] = [];
  const topArrivals: number[] = [];
  let topSamples = 0;

  for (let s = 0; s < N; s++) {
    const hypothesis = pickHypothesis(input, rand());
    const lostGoal = Math.floor(rand() * fields.length);
    const speed = Math.max(0.02, (hypothesis === DRIFT_HYPOTHESIS && input.current ? Math.hypot(input.current.eastMps, input.current.northMps) : input.speedMps) * (1 - o.speedSpread + 2 * o.speedSpread * rand()));
    const track = new Int32Array(buckets + 1).fill(-1);
    let i = input.cell;
    let t = 0;
    let arrived = false;
    const visit = (cell: number, seconds: number) => {
      const [x, y] = grid.xy(cell);
      const r = Math.min(o.radiusMaxCells, o.radiusCells + Math.floor(seconds / 60 / o.radiusGrowMinutes));
      for (const [dx, dy] of disks[r]) {
        const X = x + dx;
        const Y = y + dy;
        if (!grid.inBounds(X, Y)) continue;
        const j = grid.idx(X, Y);
        if (!grid.water[j] || stamp[j] === s) continue;
        stamp[j] = s;
        count[j]++;
        const m = seconds / 60;
        if (m < tMin[j]) tMin[j] = m;
        if (m > tMax[j]) tMax[j] = m;
        tSum[j] += m;
        tSq[j] += m * m;
      }
    };
    visit(i, 0);
    track[0] = i;
    for (let k = 0; k < MAX_STEPS && t < horizon; k++) {
      if (hypothesis >= 0 && fields[hypothesis][i] <= ARRIVED_CELLS) { arrived = true; break; }
      let step: [number, number];
      if (hypothesis >= 0) step = boltzmannStep(grid, fields[hypothesis], i, o.beta, rand);
      else if (hypothesis === DRIFT_HYPOTHESIS && input.current) step = driftStep(grid, input.current, i, o.driftSharpness, rand);
      else step = boltzmannStep(grid, fields[lostGoal], i, o.lostBeta, rand);
      const before = t;
      t += (step[1] * grid.cellMeters) / speed;
      i = step[0];
      visit(i, t);
      for (let b = Math.floor(before / bucketSeconds) + 1; b <= Math.min(buckets, Math.floor(t / bucketSeconds)); b++) track[b] = i;
    }
    for (let b = 1; b <= buckets; b++) if (track[b] < 0) track[b] = i;
    positions.push(track);
    isTop.push(hypothesis === topTarget);
    if (hypothesis === topTarget) {
      topSamples++;
      if (arrived) topArrivals.push(t / 60);
    }
  }

  const passShare = new Float32Array(size);
  const timeEarly = new Float32Array(size).fill(NaN);
  const timeLate = new Float32Array(size).fill(NaN);
  for (let j = 0; j < size; j++) {
    const n = count[j];
    if (!n) continue;
    passShare[j] = n / N;
    const mean = tSum[j] / n;
    const sd = Math.sqrt(Math.max(0, tSq[j] / n - mean * mean));
    timeEarly[j] = Math.max(tMin[j], mean - Z_WINDOW * sd);
    timeLate[j] = Math.min(tMax[j], mean + Z_WINDOW * sd);
  }

  const likely = new Uint8Array(size);
  const need = Math.ceil(o.likelyShare * N);
  for (let b = 0; b <= buckets; b++) {
    const tops: number[] = [];
    for (let s = 0; s < N; s++) if (isTop[s]) tops.push(positions[s][b]);
    if (tops.length < 0.3 * N) break;
    const m = medoid(grid, tops);
    const ds: number[] = [];
    for (let s = 0; s < N; s++) {
      const [x, y] = grid.xy(positions[s][b]);
      ds.push(Math.hypot(x - m[0], y - m[1]));
    }
    ds.sort((a, c) => a - c);
    const radius = Math.max(o.radiusCells, ds[need - 1] + 1);
    if (radius > o.likelyMaxRadiusCells) continue;
    const R = Math.ceil(radius);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const X = m[0] + dx;
      const Y = m[1] + dy;
      if (!grid.inBounds(X, Y)) continue;
      const j = grid.idx(X, Y);
      if (grid.water[j]) likely[j] = 1;
    }
  }

  const ticks: ForecastTick[] = [];
  const tickBuckets = Math.max(1, Math.round((o.tickMinutes * 60) / bucketSeconds));
  for (let b = tickBuckets; b <= buckets; b += tickBuckets) {
    const moving: number[] = [];
    for (let s = 0; s < N; s++) {
      if (!isTop[s]) continue;
      const c = positions[s][b];
      if (fields[topTarget][c] > ARRIVED_CELLS) moving.push(c);
    }
    if (moving.length < 0.5 * topSamples || moving.length < 3) break;
    const m = medoid(grid, moving);
    ticks.push({ minutes: Math.round((b * bucketSeconds) / 60), cell: grid.idx(m[0], m[1]) });
  }

  topArrivals.sort((a, c) => a - c);
  const arrival: ArrivalWindow | null = topArrivals.length
    ? { target: topTarget, share: topSamples ? topArrivals.length / topSamples : 0, early: quantile(topArrivals, 0.1), median: quantile(topArrivals, 0.5), late: quantile(topArrivals, 0.9) }
    : null;

  return { samples: N, topTarget, passShare, likely, timeEarly, timeLate, ticks, arrival };
}

function blur3(grid: Grid, src: Float32Array): Float32Array {
  const { nx, ny } = grid;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const K = [1, 2, 1];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let s = 0;
    let w = 0;
    for (let k = -1; k <= 1; k++) {
      const X = x + k;
      if (X < 0 || X >= nx) continue;
      s += src[y * nx + X] * K[k + 1];
      w += K[k + 1];
    }
    tmp[y * nx + x] = s / w;
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let s = 0;
    let w = 0;
    for (let k = -1; k <= 1; k++) {
      const Y = y + k;
      if (Y < 0 || Y >= ny) continue;
      s += tmp[Y * nx + x] * K[k + 1];
      w += K[k + 1];
    }
    out[y * nx + x] = grid.water[y * nx + x] ? s / w : 0;
  }
  return out;
}

function cornerToLonLat(grid: Grid, gx: number, gy: number): LonLat {
  return [grid.bbox.west + gx * grid.dlon, grid.bbox.north - gy * grid.dlat];
}

function ringsAt(grid: Grid, values: Float32Array, threshold: number): LonLat[][][] {
  const shape = contours().size([grid.nx, grid.ny]).thresholds([threshold])(Array.from(values))[0];
  return (shape?.coordinates ?? []).map((poly) => poly.map((ring) => ring.map(([x, y]) => cornerToLonLat(grid, x, y))));
}

export function forecastShapes(grid: Grid, f: Forecast, carefulShare: number = FORECAST_DEFAULTS.carefulShare): ForecastShapes {
  const likely = blur3(grid, Float32Array.from(f.likely));
  const careful = blur3(grid, f.passShare);
  for (let j = 0; j < careful.length; j++) if (likely[j] >= 0.5 && careful[j] < carefulShare) careful[j] = carefulShare;
  return { likely: ringsAt(grid, likely, 0.5), careful: ringsAt(grid, careful, carefulShare) };
}

export function cellCrossing(f: Forecast, cell: number, carefulShare: number = FORECAST_DEFAULTS.carefulShare): CellCrossing {
  const layer: ForecastLayer | null = f.likely[cell] ? 'likely' : f.passShare[cell] >= carefulShare ? 'careful' : null;
  return { layer, early: f.timeEarly[cell], late: f.timeLate[cell] };
}
