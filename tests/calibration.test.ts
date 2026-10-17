import { describe, expect, it } from 'vitest';
import { rng, runNightsDetailed } from '../src/engine/bench';
import {
  calibrationReport, checkpointSteps, emptyTally, runCalibration, tallyPosterior,
  type CalibrationReport, type CoverageGroup,
} from '../src/engine/calibration';
import { harbor } from './support';

const h = harbor();
const seed = 5;
const small = { nights: 120, seed, coverageNightsPerStyle: 4, forecastSamples: 300 };

function expectShare(value: number) {
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
}

function expectWellFormed(report: CalibrationReport) {
  expect(report.bins).toHaveLength(10);
  expect(report.bins.reduce((a, b) => a + b.count, 0)).toBe(report.steps);
  for (const bin of report.bins) {
    if (!bin.count) {
      expect(bin.meanPredicted).toBeNull();
      expect(bin.hitRate).toBeNull();
      continue;
    }
    expectShare(bin.hitRate!);
    expect(bin.meanPredicted!).toBeGreaterThanOrEqual(bin.low);
    expect(bin.meanPredicted!).toBeLessThanOrEqual(bin.high);
  }
  expectShare(report.brier);
  expectShare(report.ece);
  expect(report.multiclassBrier).toBeGreaterThanOrEqual(0);
  expect(report.multiclassBrier).toBeLessThanOrEqual(2);
}

function expectCoverageInRange(g: CoverageGroup) {
  expectShare(g.insideLikely);
  expectShare(g.insideCareful);
  expectShare(g.timeWindowRight);
  expect(g.insideCareful).toBeGreaterThanOrEqual(g.insideLikely);
  expect(g.crossedCells).toBeLessThanOrEqual(g.trackPoints);
}

describe('TELL calibration', () => {
  const study = runCalibration(h, { ...small, coverageNightsPerStyle: 0 });

  it('puts every TELL step of every night in exactly one bin', () => {
    let steps = 0;
    runNightsDetailed(h, { nights: small.nights, seed, nearness: true, detection: 'gates', onStep: () => { steps++; } });
    const all = study.calibration.all;
    expect(all.steps).toBe(steps);
    expect(all.nights).toBe(small.nights);
    expect(study.calibration.direct.steps + study.calibration.sloppy.steps + study.calibration.decoy.steps).toBe(steps);
    for (const report of [all, study.calibration.direct, study.calibration.sloppy, study.calibration.decoy]) expectWellFormed(report);
  });

  it('scores a perfectly confident oracle as perfectly calibrated', () => {
    const tally = emptyTally();
    runNightsDetailed(h, {
      nights: small.nights, seed, nearness: true, detection: 'gates',
      onStep: (step) => {
        const oracle = new Float64Array(step.tell.post.length);
        oracle[step.goal] = 1;
        tallyPosterior(tally, oracle, step.tell.fields.length, step.goal);
      },
    });
    const report = calibrationReport(tally);
    expect(report.steps).toBeGreaterThan(0);
    expect(report.bins[9].count).toBe(report.steps);
    expect(report.bins[9].hitRate).toBe(1);
    expect(report.brier).toBe(0);
    expect(report.multiclassBrier).toBe(0);
    expect(report.ece).toBe(0);
  });

  it('finds a forecaster that is right as often as it says nearly calibrated', () => {
    const rand = rng(seed);
    const tally = emptyTally();
    for (let k = 0; k < 20000; k++) {
      const p = rand();
      const truth = rand() < p ? 0 : 1;
      tallyPosterior(tally, [p, 1 - p], 2, truth);
    }
    const report = calibrationReport(tally);
    expect(report.bins.slice(0, 5).every((b) => b.count === 0)).toBe(true);
    expect(report.ece).toBeLessThan(0.02);
  });

  it('leaves the benchmark nights unchanged when listening to steps', () => {
    const plain = runNightsDetailed(h, { nights: 60, seed, nearness: true, detection: 'gates' });
    const listened = runNightsDetailed(h, { nights: 60, seed, nearness: true, detection: 'gates', onStep: () => undefined });
    expect(listened).toEqual(plain);
  });
});

describe('forecast coverage', () => {
  const study = runCalibration(h, small);

  it('repeats exactly for the same seed', () => {
    expect(runCalibration(h, small)).toEqual(study);
  });

  it('keeps every coverage share in range and counts its nights', () => {
    const { coverage } = study;
    for (const g of [coverage.direct, coverage.sloppy, coverage.decoy]) {
      expect(g.nights).toBe(small.coverageNightsPerStyle);
      expect(g.forecasts).toBeGreaterThan(0);
      expect(g.forecasts).toBeLessThanOrEqual(g.nights * coverage.checkpoints.length);
      expect(g.trackPoints).toBeGreaterThan(0);
      expectCoverageInRange(g);
    }
    expectCoverageInRange(coverage.all);
    expect(coverage.all.nights).toBe(3 * small.coverageNightsPerStyle);
    expect(coverage.all.trackPoints).toBe(coverage.direct.trackPoints + coverage.sloppy.trackPoints + coverage.decoy.trackPoints);
    expect(study.pitch.insideCareful).toBe(coverage.all.insideCareful);
    expect(study.pitch.trackPoints).toBe(coverage.all.trackPoints);
  });

  it('keeps the true path of a direct intruder inside the yellow layer', () => {
    expect(study.coverage.direct.insideCareful).toBeGreaterThanOrEqual(0.9);
  });

  it('places checkpoints inside the track and skips the ends', () => {
    expect(checkpointSteps(100, [0.1, 0.3, 0.5, 0.7])).toEqual([10, 30, 50, 70]);
    expect(checkpointSteps(3, [0.1, 0.3, 0.5, 0.7])).toEqual([1]);
    expect(checkpointSteps(1, [0.5])).toEqual([]);
  });
});
