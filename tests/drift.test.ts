import { describe, expect, it } from 'vitest';
import { runScenario, scenarioCurrent } from '../src/engine/scenarios';
import { defaultSettings } from '../src/engine/settings';
import {
  createTell, currentInGrid, DRIFT, driftMoveLikelihood, driftOdds, lostOdds, observe, odds, speedConsistency, topGoal,
} from '../src/engine/tell';
import { harbor } from './support';

const h = harbor();
const n = h.targets.length;
const tell = defaultSettings.tell;

function openWaterCell(): number {
  for (let i = 0; i < h.grid.water.length; i++) if (h.grid.neighbors[i].length === 16) {
    const [x, y] = h.grid.xy(i);
    if (x > 100 && y > 150) return i;
  }
  throw new Error('no open water');
}

function neighborAt(cell: number, dx: number, dy: number): number {
  const [x, y] = h.grid.xy(cell);
  return h.grid.idx(x + dx, y + dy);
}

describe('drift hypothesis: incident C with the current', () => {
  const withCurrent = runScenario('C', h, defaultSettings, { withCurrent: true });
  const without = runScenario('C', h, defaultSettings, { withCurrent: false });

  it('never calls a target', () => {
    expect(withCurrent.recs.every((r) => r.call === null)).toBe(true);
  });

  it('keeps lost plus drift odds above 50% for most of the run', () => {
    const lostLooking = withCurrent.recs.filter((r) => r.lostOdds > 0.5).length / withCurrent.recs.length;
    expect(lostLooking).toBeGreaterThan(0.75);
    expect(withCurrent.recs.slice(1).every((r) => r.lostOdds > 0.5)).toBe(true);
  });

  it('reads as drifting once it has moved a few cells', () => {
    const late = withCurrent.recs.slice(Math.floor(withCurrent.recs.length / 2));
    expect(late.every((r) => r.top === 'drift')).toBe(true);
  });

  it('fixes the open issue: without the current TELL still calls pier400', () => {
    expect(without.recs.some((r) => r.call === 'pier400')).toBe(true);
  });

  it('moves along the same track either way', () => {
    expect(withCurrent.track).toEqual(without.track);
  });

  it('stays Low the whole time', () => {
    expect(withCurrent.recs.every((r) => r.level === 0)).toBe(true);
  });
});

describe('drift hypothesis: a powered contact', () => {
  it('keeps drift odds near zero at 2 m/s', () => {
    const a = runScenario('A', h, defaultSettings, { withCurrent: true });
    expect(a.recs[0].drift).toBeCloseTo(tell.driftPrior, 6);
    expect(Math.max(...a.recs.slice(1).map((r) => r.drift))).toBeLessThan(1e-6);
    expect(a.recs.every((r) => r.top !== 'drift')).toBe(true);
  });

  it('keeps drift odds near zero when it moves straight down the current at 2 m/s', () => {
    const current = scenarioCurrent(defaultSettings);
    const T = createTell(h.grid, h.targets, { current });
    let cell = openWaterCell();
    for (let k = 0; k < 20; k++) {
      const next = neighborAt(cell, 1, 1);
      if (!h.grid.isWater(next)) break;
      observe(T, cell, next, { ...current, contactSpeedMps: 2 });
      cell = next;
    }
    expect(T.steps).toBeGreaterThan(10);
    expect(driftOdds(T)).toBeLessThan(1e-6);
  });
});

describe('drift likelihood', () => {
  it('turns north into negative grid y', () => {
    expect(currentInGrid({ currentU: 0.1, currentV: 0.2 })).toEqual([0.1, -0.2]);
    const C = scenarioCurrent(defaultSettings);
    const [gx, gy] = currentInGrid(C);
    const dir = defaultSettings.scenarios.current.gridDirection;
    expect(gx / Math.hypot(gx, gy)).toBeCloseTo(dir[0], 12);
    expect(gy / Math.hypot(gx, gy)).toBeCloseTo(dir[1], 12);
    expect(Math.hypot(C.currentU, C.currentV)).toBeCloseTo(defaultSettings.scenarios.current.speedMps, 12);
  });

  it('favors the neighbor that lines up with the current', () => {
    const cell = openWaterCell();
    const T = createTell(h.grid, h.targets, { current: { currentU: 0, currentV: 0.2 } });
    const north = driftMoveLikelihood(T, cell, neighborAt(cell, 0, -1), { contactSpeedMps: 0.2 });
    const south = driftMoveLikelihood(T, cell, neighborAt(cell, 0, 1), { contactSpeedMps: 0.2 });
    const east = driftMoveLikelihood(T, cell, neighborAt(cell, 1, 0), { contactSpeedMps: 0.2 });
    expect(north).toBeGreaterThan(east);
    expect(east).toBeGreaterThan(south);
    const nb = h.grid.neighbors[cell];
    let total = 0;
    for (let k = 0; k < nb.length; k += 2) total += driftMoveLikelihood(T, cell, nb[k], { contactSpeedMps: 0.2 });
    expect(total).toBeCloseTo(1, 12);
  });

  it('collapses when the speed does not match the current', () => {
    expect(speedConsistency(0.2, 0.2, tell.driftToleranceMps, tell.driftSpeedFalloffMps)).toBe(1);
    expect(speedConsistency(0.35, 0.2, tell.driftToleranceMps, tell.driftSpeedFalloffMps)).toBe(1);
    expect(speedConsistency(0.5, 0.2, tell.driftToleranceMps, tell.driftSpeedFalloffMps)).toBeLessThan(0.15);
    expect(speedConsistency(2.0, 0.2, tell.driftToleranceMps, tell.driftSpeedFalloffMps)).toBeLessThan(1e-12);
  });
});

describe('drift slot without a current', () => {
  it('has zero prior and never wins', () => {
    const T = createTell(h.grid, h.targets);
    expect(T.prior[n + 1]).toBe(0);
    const cell = openWaterCell();
    observe(T, cell, neighborAt(cell, 1, 0), { contactSpeedMps: 0.2 });
    expect(driftOdds(T)).toBe(0);
    expect(topGoal(T).goal).not.toBe(DRIFT);
    expect(odds(T).find((o) => o.goal === DRIFT)?.p).toBe(0);
  });

  it('counts drift in the lost odds used as hostility evidence', () => {
    const T = createTell(h.grid, h.targets, { current: { currentU: 0.12, currentV: -0.16 } });
    expect(lostOdds(T)).toBeCloseTo(tell.lostPrior + tell.driftPrior, 12);
  });

  it('never produces a call for drift', () => {
    const T = createTell(h.grid, h.targets, { current: { currentU: 0.12, currentV: -0.16 } });
    let cell = openWaterCell();
    for (let k = 0; k < 40; k++) {
      const next = neighborAt(cell, 1, 1);
      if (!h.grid.isWater(next)) break;
      observe(T, cell, next, { contactSpeedMps: 0.2 });
      cell = next;
      expect(T.call === null || T.call.goal >= 0).toBe(true);
    }
    expect(T.steps).toBeGreaterThan(10);
    expect(topGoal(T).goal).toBe(DRIFT);
  });
});
