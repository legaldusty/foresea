import { describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { cellCrossing, forecastPaths, forecastShapes, type ForecastInput } from '../src/engine/forecast';

const h = buildHarbor(gridJson as never, defaultSettings);
const g = h.grid;
const at = (id: string) => h.targets.findIndex((t) => t.id === id);
const gate = h.spawns.find((s) => s.name === 'Outside Angels Gate')!.cell;
const fuel = at('fuel');
const pier400 = at('pier400');

function oddsFor(entries: [number, number][]): number[] {
  const odds = h.targets.map(() => 0);
  for (const [i, p] of entries) odds[i] = p;
  return odds;
}

function input(cell: number, odds: number[], extra: Partial<ForecastInput> = {}): ForecastInput {
  return { cell, speedMps: 1.6, targetOdds: odds, lost: 0, drift: 0, current: null, ...extra };
}

describe('forecast', () => {
  it('lays a likely corridor from the contact to a confident target', () => {
    const f = forecastPaths(g, h.fields, input(gate, oddsFor([[fuel, 1]])), { samples: 300 });
    expect(f.likely[gate]).toBe(1);
    expect(f.likely[h.targets[fuel].cell]).toBe(1);
    expect(f.passShare[h.targets[fuel].cell]).toBeGreaterThan(0.9);
    expect(f.arrival?.target).toBe(fuel);
    const straight = (h.fields[fuel][gate] * g.cellMeters) / 1.6 / 60;
    expect(f.arrival!.median).toBeGreaterThan(straight * 0.9);
    expect(f.arrival!.median).toBeLessThan(straight * 1.3);
    expect(f.arrival!.early).toBeLessThan(f.arrival!.late);
  });

  it('keeps both branches in the careful layer when the target is split', () => {
    const f = forecastPaths(g, h.fields, input(gate, oddsFor([[fuel, 0.5], [pier400, 0.5]])), { samples: 400 });
    expect(cellCrossing(f, h.targets[fuel].cell).layer).not.toBeNull();
    expect(cellCrossing(f, h.targets[pier400].cell).layer).not.toBeNull();
    expect(f.likely[h.targets[fuel].cell] && f.likely[h.targets[pier400].cell]).toBeFalsy();
  });

  it('gives each crossed cell a time window that grows along the path', () => {
    const f = forecastPaths(g, h.fields, input(gate, oddsFor([[fuel, 1]])), { samples: 300 });
    const near = cellCrossing(f, gate);
    const far = cellCrossing(f, h.targets[fuel].cell);
    expect(near.early).toBeLessThanOrEqual(near.late);
    expect(far.early).toBeGreaterThan(near.late);
    expect(f.ticks.length).toBeGreaterThan(2);
    for (let k = 1; k < f.ticks.length; k++) expect(f.ticks[k].minutes).toBeGreaterThan(f.ticks[k - 1].minutes);
  });

  it('repeats exactly for the same seed', () => {
    const a = forecastPaths(g, h.fields, input(gate, oddsFor([[fuel, 0.7], [pier400, 0.3]])), { samples: 200, seed: 3 });
    const b = forecastPaths(g, h.fields, input(gate, oddsFor([[fuel, 0.7], [pier400, 0.3]])), { samples: 200, seed: 3 });
    expect(Array.from(a.passShare)).toEqual(Array.from(b.passShare));
  });

  it('carries a drifting robot with the current', () => {
    const research = h.targets[at('research')].cell;
    const f = forecastPaths(g, h.fields, input(research, h.targets.map(() => 0), { speedMps: 0.2, drift: 1, current: { eastMps: 0, northMps: -0.2 } }), { samples: 200, horizonMinutes: 60 });
    let sy = 0;
    let n = 0;
    for (let j = 0; j < f.passShare.length; j++) if (f.passShare[j] > 0.3) { sy += g.xy(j)[1]; n++; }
    expect(n).toBeGreaterThan(0);
    expect(sy / n).toBeGreaterThan(g.xy(research)[1]);
  });

  it('draws the careful layer around the likely layer', () => {
    const f = forecastPaths(g, h.fields, input(gate, oddsFor([[fuel, 0.8], [pier400, 0.2]])), { samples: 300 });
    const shapes = forecastShapes(g, f);
    expect(shapes.likely.length).toBeGreaterThan(0);
    expect(shapes.careful.length).toBeGreaterThan(0);
  });
});
