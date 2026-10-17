const SQRT2 = Math.SQRT2;
const DEFAULT_WATER_SEARCH_CELLS = 20;

export interface BBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface GridJson {
  nx: number;
  ny: number;
  dlon: number;
  dlat: number;
  bbox: BBox;
  cellMeters: number;
  rle: number[][];
  name?: string;
  source?: string;
  breakwaters?: Record<string, number[][]>;
}

export interface Grid {
  nx: number;
  ny: number;
  dlon: number;
  dlat: number;
  bbox: BBox;
  cellMeters: number;
  water: Uint8Array;
  neighbors: number[][];
  idx: (x: number, y: number) => number;
  xy: (i: number) => [number, number];
  inBounds: (x: number, y: number) => boolean;
  isWater: (i: number) => boolean;
  toCell: (lon: number, lat: number) => [number, number];
  toLonLat: (x: number, y: number) => [number, number];
}

export type BlockedMask = ArrayLike<number | boolean> | null;

function decodeWater(json: GridJson): Uint8Array {
  const { nx, ny } = json;
  const water = new Uint8Array(nx * ny);
  json.rle.forEach((runs, y) => {
    let x = 0;
    let isLand = false;
    for (const n of runs) {
      if (!isLand) for (let k = 0; k < n; k++) water[y * nx + x + k] = 1;
      x += n;
      isLand = !isLand;
    }
  });
  return water;
}

export function loadGrid(json: GridJson): Grid {
  const { nx, ny, dlon, dlat, bbox, cellMeters } = json;
  const water = decodeWater(json);
  const grid: Grid = {
    nx, ny, dlon, dlat, bbox, cellMeters, water,
    neighbors: [],
    idx: (x, y) => y * nx + x,
    xy: (i) => [i % nx, (i / nx) | 0],
    inBounds: (x, y) => x >= 0 && y >= 0 && x < nx && y < ny,
    isWater: (i) => water[i] === 1,
    toCell: (lon, lat) => [Math.floor((lon - bbox.west) / dlon), Math.floor((bbox.north - lat) / dlat)],
    toLonLat: (x, y) => [bbox.west + (x + 0.5) * dlon, bbox.north - (y + 0.5) * dlat],
  };
  grid.neighbors = buildNeighbors(grid);
  return grid;
}

const NEIGHBOR_STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

function buildNeighbors(g: Grid): number[][] {
  const { nx, ny, water } = g;
  const nb: number[][] = new Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x;
    if (!water[i]) { nb[i] = []; continue; }
    const list: number[] = [];
    for (const [dx, dy, c] of NEIGHBOR_STEPS) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
      const j = Y * nx + X;
      if (!water[j]) continue;
      if (dx && dy && (!water[y * nx + X] || !water[Y * nx + x])) continue;
      list.push(j, c);
    }
    nb[i] = list;
  }
  return nb;
}

export function nearestWater(g: Grid, x: number, y: number, maxR = DEFAULT_WATER_SEARCH_CELLS): number {
  x = Math.max(0, Math.min(g.nx - 1, x));
  y = Math.max(0, Math.min(g.ny - 1, y));
  for (let r = 0; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const X = x + dx;
      const Y = y + dy;
      if (g.inBounds(X, Y) && g.water[g.idx(X, Y)]) return g.idx(X, Y);
    }
  return -1;
}

export class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.values;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop(): number {
    const k = this.keys;
    const v = this.values;
    const top = v[0];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    const n = k.length;
    if (n) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

export function distanceField(g: Grid, target: number, blocked: BlockedMask = null): Float32Array {
  const D = new Float32Array(g.nx * g.ny).fill(Infinity);
  const h = new MinHeap();
  D[target] = 0;
  h.push(0, target);
  while (h.size) {
    const i = h.pop();
    const di = D[i];
    const nb = g.neighbors[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k];
      if (blocked && blocked[j]) continue;
      const nd = di + nb[k + 1];
      if (nd < D[j]) { D[j] = nd; h.push(nd, j); }
    }
  }
  return D;
}

function octileHeuristic(g: Grid, goal: number): (i: number) => number {
  const [gx, gy] = g.xy(goal);
  return (i) => {
    const x = i % g.nx;
    const y = (i / g.nx) | 0;
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
}

function tracePath(from: Map<number, number>, end: number): number[] {
  const p = [end];
  let c = end;
  while (from.has(c)) { c = from.get(c) as number; p.push(c); }
  return p.reverse();
}

export function findPath(g: Grid, start: number, goal: number, blocked: BlockedMask = null): number[] | null {
  if (start === goal) return [start];
  const H = octileHeuristic(g, goal);
  const G = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  const h = new MinHeap();
  h.push(H(start), start);
  const closed = new Set<number>();
  while (h.size) {
    const i = h.pop();
    if (i === goal) return tracePath(from, i);
    if (closed.has(i)) continue;
    closed.add(i);
    const gi = G.get(i) as number;
    const nb = g.neighbors[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k];
      if (blocked && blocked[j] && j !== goal) continue;
      const ng = gi + nb[k + 1];
      if (ng < (G.get(j) ?? Infinity)) { G.set(j, ng); from.set(j, i); h.push(ng + H(j), j); }
    }
  }
  return null;
}

export function pathLength(g: Grid, path: ArrayLike<number>): number {
  let L = 0;
  for (let k = 1; k < path.length; k++) {
    const [x0, y0] = g.xy(path[k - 1]);
    const [x1, y1] = g.xy(path[k]);
    L += (x0 !== x1 && y0 !== y1) ? SQRT2 : 1;
  }
  return L;
}

function isNeighbor(g: Grid, i: number, j: number): boolean {
  const nb = g.neighbors[i];
  for (let k = 0; k < nb.length; k += 2) if (nb[k] === j) return true;
  return false;
}

export function walkLine(g: Grid, a: number, b: number): number[] {
  const [x0, y0] = g.xy(a);
  const [x1, y1] = g.xy(b);
  const out: number[] = [];
  let cx = x0;
  let cy = y0;
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 1; s <= steps; s++) {
    const tx = Math.round(x0 + (x1 - x0) * s / steps);
    const ty = Math.round(y0 + (y1 - y0) * s / steps);
    const j = g.idx(tx, ty);
    const i = g.idx(cx, cy);
    if (j === i) continue;
    if (!isNeighbor(g, i, j)) break;
    out.push(j);
    cx = tx;
    cy = ty;
  }
  return out;
}

export function disk(g: Grid, i: number, r: number): number[] {
  const [x, y] = g.xy(i);
  const out: number[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const X = x + dx;
    const Y = y + dy;
    if (g.inBounds(X, Y)) out.push(g.idx(X, Y));
  }
  return out;
}

export function metersToCells(g: Pick<Grid, 'cellMeters'>, meters: number): number {
  return meters / g.cellMeters;
}

export function cellsToMeters(g: Pick<Grid, 'cellMeters'>, cells: number): number {
  return cells * g.cellMeters;
}
