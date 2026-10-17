import { describe, expect, it } from 'vitest';
import { rng, runNights, STYLES } from '../src/engine/bench';
import {
  createTell, DRIFT, DRIFT_NAME, evasiveness, LOST, LOST_NAME, lostOdds, observe, odds, predictedPath, proximityPrior,
  resetTell, topGoal, uncertainty, type TellState,
} from '../src/engine/tell';
import { defaultSettings } from '../src/engine/settings';
import { harbor, loadStarter, starterHarbor, STARTER_TELL } from './support';

const starter = await loadStarter();
const h = harbor();
const ref = await starterHarbor();
const n = h.targets.length;

function wander(steps: number, seed: number, start: number): number[] {
  const rand = rng(seed);
  const cells = [start];
  let cell = start;
  for (let s = 0; s < steps; s++) {
    const nb = h.grid.neighbors[cell];
    const pick = Math.floor(rand() * (nb.length / 2)) * 2;
    cell = nb[pick];
    cells.push(cell);
  }
  return cells;
}

function headFor(goal: number, start: number): number[] {
  return predictedPath({ fields: h.fields, grid: h.grid }, goal, start);
}

function expectSamePosterior(T: TellState, R: any) {
  expect(Array.from(T.post.subarray(0, n + 1))).toEqual(Array.from(R.post));
  expect(T.post[n + 1]).toBe(0);
}

function replay(cells: number[], prepare?: (T: TellState, R: any) => void) {
  const T = createTell(h.grid, h.targets, STARTER_TELL);
  const R = starter.tell.createTell(ref.grid, ref.targets);
  prepare?.(T, R);
  for (let k = 1; k < cells.length; k++) {
    observe(T, cells[k - 1], cells[k]);
    starter.tell.observe(R, cells[k - 1], cells[k]);
    expectSamePosterior(T, R);
    expect(T.call).toEqual(R.call);
    expect(T.steps).toBe(R.steps);
    expect(T.pathCells).toBe(R.pathCells);
    expect(topGoal(T)).toEqual(starter.tell.topGoal(R));
    expect(uncertainty(T)).toBe(starter.tell.uncertainty(R));
    expect(evasiveness(T, cells[0], cells[k])).toBe(starter.tell.evasiveness(R, cells[0], cells[k]));
  }
  return { T, R };
}

describe('TELL parity with the starter', () => {
  it('places targets on the same cells', () => {
    expect(h.targets.map((t) => t.cell)).toEqual(ref.targets.map((t: { cell: number }) => t.cell));
    expect(h.spawns.map((s) => s.cell)).toEqual(ref.spawns.map((s: { cell: number }) => s.cell));
  });

  it('starts from the same prior', () => {
    const T = createTell(h.grid, h.targets, STARTER_TELL);
    const R = starter.tell.createTell(ref.grid, ref.targets);
    expectSamePosterior(T, R);
    expect(Array.from(T.prior.subarray(0, n + 1))).toEqual(Array.from(R.prior));
  });

  it('gives identical posteriors for a purposeful track', () => {
    const fuel = h.targets.findIndex((t) => t.id === 'fuel');
    const { T } = replay(headFor(fuel, h.spawns[0].cell));
    expect(T.call?.goal).toBe(fuel);
  });

  it('gives identical posteriors for a wandering track', () => {
    replay(wander(300, 19, h.spawns[1].cell));
  });

  it('gives identical posteriors with a different beta', () => {
    const cells = headFor(0, h.spawns[2].cell);
    const T = createTell(h.grid, h.targets, { ...STARTER_TELL, beta: 0.8 });
    const R = starter.tell.createTell(ref.grid, ref.targets, { beta: 0.8 });
    for (let k = 1; k < cells.length; k++) {
      observe(T, cells[k - 1], cells[k]);
      starter.tell.observe(R, cells[k - 1], cells[k]);
    }
    expectSamePosterior(T, R);
  });

  it('lists odds like the starter plus a drift entry', () => {
    const { T, R } = replay(wander(40, 5, h.spawns[0].cell));
    const ours = odds(T);
    const theirs = starter.tell.odds(R);
    expect(ours.filter((o) => o.goal !== DRIFT).map(({ goal, name, p }) => ({ goal, name, p }))).toEqual(theirs);
    expect(ours.find((o) => o.goal === LOST)?.name).toBe(LOST_NAME);
    expect(ours.find((o) => o.goal === DRIFT)?.name).toBe(DRIFT_NAME);
  });

  it('predicts the same path', () => {
    const { T, R } = replay(wander(20, 8, h.spawns[0].cell));
    const from = h.spawns[1].cell;
    for (let g = 0; g < n; g++) expect(predictedPath(T, g, from)).toEqual(starter.tell.predictedPath(R, g, from));
  });

  it('resets to the prior', () => {
    const { T } = replay(wander(30, 2, h.spawns[0].cell));
    resetTell(T);
    expect(Array.from(T.post)).toEqual(Array.from(T.prior));
    expect(T.call).toBeNull();
    expect(T.steps).toBe(0);
  });

  it('produces identical bench summaries for the same seed', () => {
    for (const nights of [150, 600]) {
      const ours = runNights(h, { nights, seed: 7, tellOpts: STARTER_TELL });
      const theirs = starter.bench.runNights(ref, { nights, seed: 7 });
      expect(ours).toEqual(theirs);
    }
    const ours = runNights(h, { nights: 300, seed: 21, tellOpts: { ...STARTER_TELL, beta: 2.0 } });
    expect(ours).toEqual(starter.bench.runNights(ref, { nights: 300, seed: 21, tellOpts: { beta: 2.0 } }));
  });

  it('matches the starter styles and random stream', () => {
    expect(STYLES).toEqual(starter.bench.STYLES);
    const a = rng(42);
    const b = starter.bench.rng(42);
    for (let k = 0; k < 100; k++) expect(a()).toBe(b());
  });
});

describe('call logic', () => {
  it('calls only after callSteps moves at or above callAt on the same target', () => {
    const fuel = h.targets.findIndex((t) => t.id === 'fuel');
    const cells = headFor(fuel, h.spawns[0].cell);
    const T = createTell(h.grid, h.targets);
    const { callAt, callSteps } = defaultSettings.tell;
    let streak = 0;
    let streakGoal = LOST;
    let firstReady: number | null = null;
    let firstCall: number | null = null;
    for (let k = 1; k < cells.length; k++) {
      observe(T, cells[k - 1], cells[k]);
      const top = topGoal(T);
      if (top.goal >= 0 && top.p >= callAt) {
        streak = top.goal === streakGoal ? streak + 1 : 1;
        streakGoal = top.goal;
      } else {
        streak = 0;
        streakGoal = LOST;
      }
      if (streak >= callSteps) firstReady ??= T.steps;
      if (T.call) firstCall ??= T.call.step;
    }
    expect(firstCall).not.toBeNull();
    expect(firstCall).toBe(firstReady);
    expect(T.call?.goal).toBe(fuel);
  });
});

describe('rule 2: relative nearness prior', () => {
  it('weights each target by (nearest distance / its distance) squared', () => {
    const start = h.spawns[0].cell;
    const T = createTell(h.grid, h.targets, STARTER_TELL);
    proximityPrior(T, start);
    const d = h.fields.map((D) => D[start]);
    const dmin = Math.min(...d);
    const w = d.map((x) => Math.pow(dmin / x, 2));
    const s = w.reduce((a, b) => a + b, 0);
    const lost = defaultSettings.tell.lostPrior;
    for (let g = 0; g < n; g++) expect(T.prior[g]).toBe((1 - lost) * w[g] / s);
    expect(T.prior[n]).toBe(lost);
    expect(Array.from(T.post)).toEqual(Array.from(T.prior));
    const nearest = d.indexOf(dmin);
    expect(topGoal(T).goal).toBe(nearest);
  });

  it('keeps room for the drift slot when a current is known', () => {
    const T = createTell(h.grid, h.targets, { current: { currentU: 0.1, currentV: 0 } });
    proximityPrior(T, h.spawns[0].cell);
    const sum = Array.from(T.prior).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(T.prior[n + 1]).toBe(defaultSettings.tell.driftPrior);
    expect(lostOdds(T)).toBeCloseTo(defaultSettings.tell.lostPrior + defaultSettings.tell.driftPrior, 12);
  });
});
