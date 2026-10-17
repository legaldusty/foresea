import { describe, expect, it } from 'vitest';
import { benchAcceptance, runNights, runNightsDetailed, summarize } from '../src/engine/bench';
import { defaultSettings } from '../src/engine/settings';
import { harbor } from './support';

const h = harbor();
const nights = 600;
const bench = defaultSettings.bench;

describe('benchmark acceptance bar (600 nights, final rules)', () => {
  const gates = runNights(h, { nights, nearness: true, detection: 'gates' });

  it('gives at least 1.4x the nearest-dock warning at the gates', () => {
    const bar = benchAcceptance(gates);
    expect(bar.warningRatio).toBeGreaterThanOrEqual(bench.acceptance.minWarningRatio);
  });

  it('calls the right target by arrival in at least 99% of runs', () => {
    expect(gates.all.tellCalledRight).toBeGreaterThanOrEqual(bench.acceptance.minRightByArrival);
    expect(benchAcceptance(gates).passes).toBe(true);
  });

  it('warns earlier with the nearness prior than without it', () => {
    const starterRules = runNights(h, { nights, nearness: false, detection: 'gates' });
    expect(gates.all.tellWarnMin).toBeGreaterThan(starterRules.all.tellWarnMin);
    expect(gates.all.baseWarnMin).toBe(starterRules.all.baseWarnMin);
  });
});

describe('close-in detection', () => {
  const detailed = runNightsDetailed(h, { nights, nearness: true, detection: 'closeIn' });

  it('starts every intruder 1 to 3 km of route from its true target', () => {
    const cellsToMinutes = h.grid.cellMeters / bench.speedMps / 60;
    const diagonal = Math.SQRT2;
    const minMin = (bench.closeInMinMeters / h.grid.cellMeters - diagonal) * cellsToMinutes;
    const maxMin = (bench.closeInMaxMeters / h.grid.cellMeters) * cellsToMinutes;
    for (const night of detailed) {
      expect(night.totalMin).toBeGreaterThanOrEqual(minMin);
      expect(night.totalMin).toBeLessThanOrEqual(maxMin);
    }
  });

  it('still calls the right target by arrival', () => {
    expect(summarize(detailed).all.tellCalledRight).toBeGreaterThanOrEqual(bench.acceptance.minRightByArrival);
  });

  it('is seeded and repeatable', () => {
    expect(runNights(h, { nights: 90, nearness: true, detection: 'closeIn', seed: 3 })).toEqual(runNights(h, { nights: 90, nearness: true, detection: 'closeIn', seed: 3 }));
  });
});
