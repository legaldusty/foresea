import { findPath, pathLength } from './grid';
import type { GridLike } from './zones';

export type RerouteStatus = 'clear' | 'rerouted' | 'leaveZone' | 'destinationInZone' | 'noPath';

export interface RerouteResult {
  status: RerouteStatus;
  cells: number[];
  addedCells: number;
  addedMin: number;
}

export function travelMinutes(grid: GridLike, cells: number, speedMps: number): number {
  return speedMps > 0 ? (cells * grid.cellMeters) / speedMps / 60 : Infinity;
}

export function routeLength(grid: GridLike, route: number[]): number {
  return route.length > 1 ? pathLength(grid as never, route) : 0;
}

export function planRoute(grid: GridLike, from: number, to: number, blocked: Uint8Array | null = null): number[] | null {
  return findPath(grid as never, from, to, blocked as never);
}

export function routeEntersMask(route: number[], mask: Uint8Array | null): boolean {
  if (!mask) return false;
  for (const c of route) if (mask[c]) return true;
  return false;
}

export function firstIndexInMask(route: number[], mask: Uint8Array | null): number {
  if (!mask) return -1;
  for (let k = 0; k < route.length; k++) if (mask[route[k]]) return k;
  return -1;
}

export function exitZone(grid: GridLike, from: number, mask: Uint8Array, toward: number | null = null): number[] | null {
  if (!mask[from]) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  const exits: number[] = [];
  while (queue.length) {
    const i = queue.shift() as number;
    if (!mask[i]) { exits.push(i); if (exits.length >= 12) break; continue; }
    const nb = grid.neighbors[i];
    for (let k = 0; k < nb.length; k += 2) {
      const j = nb[k];
      if (!prev.has(j)) { prev.set(j, i); queue.push(j); }
    }
  }
  if (!exits.length) return null;
  let pick = exits[0];
  if (toward !== null) {
    const [tx, ty] = grid.xy(toward);
    let best = Infinity;
    for (const e of exits) { const [x, y] = grid.xy(e); const d = Math.hypot(x - tx, y - ty); if (d < best) { best = d; pick = e; } }
  }
  const path = [pick];
  let c = prev.get(pick) as number;
  while (c !== -1 && c !== undefined) { path.push(c); c = prev.get(c) as number; }
  return path.reverse();
}

export function rerouteAround(grid: GridLike, route: number[], mask: Uint8Array | null, speedMps: number): RerouteResult {
  const none = { cells: route, addedCells: 0, addedMin: 0 };
  if (!mask || route.length < 2 || !routeEntersMask(route, mask)) return { status: 'clear', ...none };
  const start = route[0];
  const goal = route[route.length - 1];
  if (mask[goal]) return { status: 'destinationInZone', ...none };
  const before = routeLength(grid, route);
  let cells: number[] | null;
  let status: RerouteStatus = 'rerouted';
  if (mask[start]) {
    const exit = exitZone(grid, start, mask, goal);
    if (!exit) return { status: 'noPath', ...none };
    const rest = planRoute(grid, exit[exit.length - 1], goal, mask);
    cells = rest ? [...exit, ...rest.slice(1)] : null;
    status = 'leaveZone';
  } else {
    cells = planRoute(grid, start, goal, mask);
  }
  if (!cells) return { status: 'noPath', ...none };
  const addedCells = Math.max(0, routeLength(grid, cells) - before);
  return { status, cells, addedCells, addedMin: travelMinutes(grid, addedCells, speedMps) };
}

export function dilate(grid: GridLike, mask: Uint8Array, radiusCells: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  const r = Math.ceil(radiusCells);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [x, y] = grid.xy(i);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > radiusCells * radiusCells) continue;
      const X = x + dx, Y = y + dy;
      if (grid.inBounds(X, Y)) out[grid.idx(X, Y)] = 1;
    }
  }
  return out;
}

export function passesNear(grid: GridLike, route: number[], cell: number, radiusCells: number): boolean {
  const [cx, cy] = grid.xy(cell);
  for (const c of route) { const [x, y] = grid.xy(c); if (Math.hypot(x - cx, y - cy) <= radiusCells) return true; }
  return false;
}
