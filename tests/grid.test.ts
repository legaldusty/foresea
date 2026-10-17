import { describe, expect, it } from 'vitest';
import { disk, distanceField, findPath, loadGrid, nearestWater, pathLength, walkLine } from '../src/engine/grid';
import { gridJson, loadStarter } from './support';

const starter = await loadStarter();
const grid = loadGrid(gridJson);
const reference = starter.grid.loadGrid(gridJson);

function someWaterCells(count: number): number[] {
  const cells: number[] = [];
  const stride = Math.floor(grid.water.length / count);
  for (let i = 0; i < grid.water.length && cells.length < count; i += stride) {
    const [x, y] = grid.xy(i);
    const w = nearestWater(grid, x, y, 30);
    if (w >= 0) cells.push(w);
  }
  return cells;
}

describe('grid', () => {
  it('decodes the 296 x 212 harbor grid of 50 m cells', () => {
    expect(grid.nx).toBe(296);
    expect(grid.ny).toBe(212);
    expect(grid.cellMeters).toBe(50);
    expect(grid.water).toBeInstanceOf(Uint8Array);
    expect(Array.from(grid.water)).toEqual(Array.from(reference.water));
  });

  it('builds the same neighbor lists as the starter', () => {
    for (let i = 0; i < grid.water.length; i++) expect(grid.neighbors[i]).toEqual(reference.neighbors[i]);
  });

  it('round trips cells through lon and lat', () => {
    const cell = grid.idx(120, 80);
    const [lon, lat] = grid.toLonLat(...grid.xy(cell));
    expect(grid.toCell(lon, lat)).toEqual([120, 80]);
    expect(grid.toCell(lon, lat)).toEqual(reference.toCell(lon, lat));
  });

  it('finds the nearest water cell like the starter', () => {
    for (const [x, y] of [[0, 0], [150, 100], [295, 211], [40, 30], [-5, 300]]) {
      expect(nearestWater(grid, x, y, 30)).toBe(starter.grid.nearestWater(reference, x, y, 30));
    }
  });

  it('computes identical distance fields', () => {
    for (const target of someWaterCells(4)) {
      const D = distanceField(grid, target);
      expect(D).toBeInstanceOf(Float32Array);
      expect(Array.from(D)).toEqual(Array.from(starter.grid.distanceField(reference, target)));
    }
  });

  it('respects a blocked mask like the starter', () => {
    const [target, wall] = someWaterCells(2);
    const blocked = new Uint8Array(grid.water.length);
    for (const c of disk(grid, wall, 6)) blocked[c] = 1;
    expect(Array.from(distanceField(grid, target, blocked))).toEqual(Array.from(starter.grid.distanceField(reference, target, blocked)));
  });

  it('finds the same paths and path lengths', () => {
    const cells = someWaterCells(6);
    for (let k = 1; k < cells.length; k++) {
      const path = findPath(grid, cells[k - 1], cells[k]);
      const refPath = starter.grid.findPath(reference, cells[k - 1], cells[k]);
      expect(path).toEqual(refPath);
      if (path) {
        expect(pathLength(grid, path)).toBe(starter.grid.pathLength(reference, refPath));
        expect(pathLength(grid, path)).toBeCloseTo(distanceField(grid, cells[k])[cells[k - 1]], 3);
      }
    }
    expect(findPath(grid, cells[0], cells[0])).toEqual([cells[0]]);
  });

  it('walks lines and draws disks like the starter', () => {
    const cells = someWaterCells(5);
    for (let k = 1; k < cells.length; k++) expect(walkLine(grid, cells[k - 1], cells[k])).toEqual(starter.grid.walkLine(reference, cells[k - 1], cells[k]));
    expect(disk(grid, cells[0], 3.5)).toEqual(starter.grid.disk(reference, cells[0], 3.5));
  });
});
