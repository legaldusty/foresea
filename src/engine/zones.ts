import { contours } from 'd3-contour';
import type { LonLat } from './geo';

export interface GridLike {
  nx: number;
  ny: number;
  cellMeters: number;
  water: Uint8Array;
  neighbors: ArrayLike<number>[];
  idx: (x: number, y: number) => number;
  xy: (i: number) => [number, number];
  inBounds: (x: number, y: number) => boolean;
  toCell: (lon: number, lat: number) => [number, number];
  toLonLat: (x: number, y: number) => [number, number];
}

export type ZoneKind = 'keepOut' | 'slow';

export interface ZoneGeometry {
  centerline: number[];
  radiusCells: number;
  cells: number[];
  mask: Uint8Array;
  rings: LonLat[][][];
}

const SQRT2 = Math.SQRT2;

function stepCells(grid: GridLike, a: number, b: number): number {
  const [x0, y0] = grid.xy(a);
  const [x1, y1] = grid.xy(b);
  return x0 !== x1 && y0 !== y1 ? SQRT2 : 1;
}

export function trimPath(grid: GridLike, path: number[], maxCells: number): number[] {
  const out = path.length ? [path[0]] : [];
  let travelled = 0;
  for (let k = 1; k < path.length; k++) {
    travelled += stepCells(grid, path[k - 1], path[k]);
    if (travelled > maxCells) break;
    out.push(path[k]);
  }
  return out;
}

function boundsOf(grid: GridLike, centerline: number[], pad: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of centerline) {
    const [x, y] = grid.xy(c);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const p = Math.ceil(pad) + 2;
  return {
    x0: Math.max(0, minX - p), y0: Math.max(0, minY - p),
    x1: Math.min(grid.nx - 1, maxX + p), y1: Math.min(grid.ny - 1, maxY + p),
  };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function simplifyCenterline(grid: GridLike, centerline: number[]): [number, number][] {
  const pts = centerline.map((c) => grid.xy(c));
  if (pts.length <= 2) return pts;
  const keep: [number, number][] = [pts[0]];
  for (let k = 2; k < pts.length; k += 2) keep.push(pts[k]);
  if (keep[keep.length - 1] !== pts[pts.length - 1]) keep.push(pts[pts.length - 1]);
  return keep;
}

function distanceToPolyline(x: number, y: number, pts: [number, number][]): number {
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]);
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const d = distanceToSegment(x, y, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    if (d < best) best = d;
  }
  return best;
}

export function corridor(grid: GridLike, centerline: number[], radiusCells: number, supersample = 2): ZoneGeometry {
  return multiCorridor(grid, [centerline], radiusCells, supersample);
}

export function multiCorridor(grid: GridLike, centerlines: number[][], radiusCells: number, supersample = 2): ZoneGeometry {
  const mask = new Uint8Array(grid.nx * grid.ny);
  const cells: number[] = [];
  const lines = centerlines.filter((l) => l.length);
  const centerline = lines[0] ?? [];
  if (!lines.length) return { centerline, radiusCells, cells, mask, rings: [] };
  const polylines = lines.map((l) => simplifyCenterline(grid, l));
  const b = boundsOf(grid, lines.flat(), radiusCells);
  const distanceAt = (x: number, y: number): number => {
    let best = Infinity;
    for (const pts of polylines) best = Math.min(best, distanceToPolyline(x, y, pts));
    return best;
  };
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    if (distanceAt(x, y) <= radiusCells) { const i = grid.idx(x, y); mask[i] = 1; cells.push(i); }
  }
  const s = supersample;
  const w = (b.x1 - b.x0 + 1) * s + 2, h = (b.y1 - b.y0 + 1) * s + 2;
  const values = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const gx = b.x0 + (i - 1) / s, gy = b.y0 + (j - 1) / s;
    values[j * w + i] = i === 0 || j === 0 || i === w - 1 || j === h - 1 ? -1 : radiusCells - distanceAt(gx, gy);
  }
  const shape = contours().size([w, h]).thresholds([0])(Array.from(values))[0];
  const toLonLat = (gx: number, gy: number): LonLat => {
    const cx = b.x0 + (gx - 1) / s, cy = b.y0 + (gy - 1) / s;
    return grid.toLonLat(cx - 0.5 + 0.5 / s, cy - 0.5 + 0.5 / s) as LonLat;
  };
  const rings = (shape?.coordinates ?? []).map((poly) => poly.map((ring) => ring.map(([gx, gy]) => toLonLat(gx, gy))));
  return { centerline, radiusCells, cells, mask, rings };
}

export function unionMask(grid: GridLike, masks: Uint8Array[]): Uint8Array | null {
  if (!masks.length) return null;
  const out = new Uint8Array(grid.nx * grid.ny);
  for (const m of masks) for (let i = 0; i < m.length; i++) if (m[i]) out[i] = 1;
  return out;
}

export interface SecurityZoneInput {
  contactCell: number;
  predictedPaths: number[][];
  speedMps: number;
  zoneMeters: number;
  pathMinutes: number;
  unsure: boolean;
  growWhenUnsure: number;
  silentMinutes: number;
  topSpeedMps: number;
  maxRadiusM?: number;
}

export interface SecurityZone extends ZoneGeometry {
  radiusM: number;
  aheadCells: number[][];
  grewFor: ('unsure' | 'silent')[];
}

export function securityZone(grid: GridLike, z: SecurityZoneInput): SecurityZone {
  const grewFor: ('unsure' | 'silent')[] = [];
  let radiusM = z.zoneMeters;
  if (z.unsure) { radiusM *= z.growWhenUnsure; grewFor.push('unsure'); }
  if (z.silentMinutes > 0) { radiusM += z.topSpeedMps * z.silentMinutes * 60; grewFor.push('silent'); }
  if (z.maxRadiusM !== undefined) radiusM = Math.min(radiusM, Math.max(z.zoneMeters, z.maxRadiusM));
  const aheadCellsBudget = (z.speedMps * z.pathMinutes * 60) / grid.cellMeters;
  const aheadCells = z.predictedPaths.map((p) => trimPath(grid, p, aheadCellsBudget));
  const radiusCells = radiusM / grid.cellMeters;
  const lines = aheadCells.filter((p) => p.length);
  const shape = multiCorridor(grid, lines.length ? lines : [[z.contactCell]], radiusCells);
  return { ...shape, radiusM, aheadCells, grewFor };
}

export function circleZone(grid: GridLike, centerCell: number, radiusM: number): ZoneGeometry & { radiusM: number } {
  return { ...corridor(grid, [centerCell], radiusM / grid.cellMeters), radiusM };
}

export function cellInMask(mask: Uint8Array | null, cell: number): boolean {
  return !!mask && mask[cell] === 1;
}
