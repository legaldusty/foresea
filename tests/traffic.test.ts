import { describe, expect, it } from 'vitest';
import shippedModelJson from '../src/data/traffic_model.json';
import { rng } from '../src/engine/bench';
import {
  loadTrafficModel,
  rememberReport,
  scoreVessel,
  TRAFFIC_DEFAULTS,
  trainTrafficModel,
  type TrafficModel,
  type TrafficReport,
} from '../src/engine/traffic';

const START = Date.parse('2026-10-17T06:00:00.000Z');
const MINUTE = 60_000;
const LANE_LAT = 33.735;
const LANE_WEST = -118.28;
const LANE_EAST = -118.17;
const LANE_KNOTS = 10;
const LANE_VESSELS = 40;
const BERTH = { lat: 33.765, lon: -118.27 };
const BERTHED_VESSELS = 12;
const BERTH_REPORTS = 30;
const DEG_LON_PER_MINUTE_AT_TEN_KNOTS = 0.0033;

function eastboundTrack(mmsi: number, startMs: number, random: () => number): TrafficReport[] {
  const track: TrafficReport[] = [];
  const offsetLat = (random() - 0.5) * 0.001;
  for (let k = 0, lon = LANE_WEST; lon <= LANE_EAST; k++, lon += DEG_LON_PER_MINUTE_AT_TEN_KNOTS) {
    const course = 90 + (random() - 0.5) * 8;
    track.push({
      mmsi,
      at: startMs + k * MINUTE,
      lat: LANE_LAT + offsetLat,
      lon,
      sogKn: LANE_KNOTS + (random() - 0.5) * 2,
      cogDeg: course,
      headingDeg: Math.round(course + (random() - 0.5) * 4),
      aisClass: 'A',
      navStatus: 0,
    });
  }
  return track;
}

function trainingReports(seed = 7): TrafficReport[] {
  const random = rng(seed);
  const reports: TrafficReport[] = [];
  for (let v = 0; v < LANE_VESSELS; v++) reports.push(...eastboundTrack(366000000 + v, START + v * 7 * MINUTE, random));
  for (let v = 0; v < BERTHED_VESSELS; v++) {
    for (let k = 0; k < BERTH_REPORTS; k++) {
      reports.push({
        mmsi: 367000000 + v,
        at: START + k * 3 * MINUTE + v * 1000,
        lat: BERTH.lat + v * 0.0002,
        lon: BERTH.lon,
        sogKn: 0,
        cogDeg: null,
        headingDeg: 180,
        aisClass: 'A',
        navStatus: 5,
      });
    }
  }
  return reports;
}

function shuffled<T>(items: T[], seed: number): T[] {
  const random = rng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const model: TrafficModel = trainTrafficModel(trainingReports());
const newcomer = eastboundTrack(369999999, START + 12 * 60 * MINUTE, rng(99));
const middle = Math.floor(newcomer.length / 2);
const current = newcomer[middle];
const history = newcomer.slice(middle - 10, middle);

describe('traffic model training', () => {
  it('is deterministic and does not depend on input order', () => {
    const reports = trainingReports();
    const first = JSON.stringify(trainTrafficModel(reports));
    expect(JSON.stringify(trainTrafficModel(reports))).toBe(first);
    expect(JSON.stringify(trainTrafficModel(shuffled(reports, 3)))).toBe(first);
  });

  it('records its sample size honestly', () => {
    const reports = trainingReports();
    expect(model.meta.reports).toBe(reports.length);
    expect(model.meta.vessels).toBe(LANE_VESSELS + BERTHED_VESSELS);
    expect(model.meta.movingVessels).toBe(LANE_VESSELS);
    expect(model.meta.movingReports + model.meta.stationaryReports).toBe(reports.length);
    expect(model.meta.cellMeters).toBe(TRAFFIC_DEFAULTS.training.cellMeters);
    expect(model.meta.trainedAtMs).toBe(Math.max(...reports.map((report) => report.at)));
  });
});

describe('scoreVessel', () => {
  const following = scoreVessel(model, current, history, current.at + 30_000);

  it('calls a vessel following a busy lane normal', () => {
    expect(following.level).toBe('normal');
    expect(following.score).toBeLessThan(TRAFFIC_DEFAULTS.scoring.watchAt);
    expect(following.reasons).toEqual([]);
    expect(following.nearbyReports).toBeGreaterThan(0);
  });

  it('scores the same vessel higher when it runs against the lane', () => {
    const turn = (report: TrafficReport): TrafficReport => ({
      ...report,
      cogDeg: ((report.cogDeg ?? 0) + 180) % 360,
      headingDeg: ((report.headingDeg ?? 0) + 180) % 360,
    });
    const reversed = scoreVessel(model, turn(current), history.map(turn), current.at + 30_000);
    expect(reversed.score).toBeGreaterThan(following.score);
    expect(reversed.level).not.toBe('normal');
    expect(reversed.reasons).toContain('Heading against the usual traffic in this lane');
  });

  it('flags a stop in a busy lane', () => {
    const stops = [8, 6, 4, 2].map((minutesAgo) => ({ ...current, at: current.at - minutesAgo * MINUTE, sogKn: 0 }));
    const stopped = scoreVessel(model, { ...current, sogKn: 0 }, [...history.filter((past) => past.at < stops[0].at), ...stops], current.at + 30_000);
    expect(stopped.level).not.toBe('normal');
    expect(stopped.reasons.some((reason) => reason.startsWith('Stopped') && reason.endsWith('in a lane where ships keep moving'))).toBe(true);
  });

  it('flags a long AIS gap while under way', () => {
    const silent = scoreVessel(model, current, history, current.at + 20 * MINUTE);
    expect(silent.level).not.toBe('normal');
    expect(silent.reasons).toContain('No AIS report for 20 minutes while under way');
  });

  it('flags a vessel far faster than the lane', () => {
    const fast = scoreVessel(model, { ...current, sogKn: 30 }, history, current.at + 30_000);
    expect(fast.level).not.toBe('normal');
    expect(fast.reasons.some((reason) => reason.startsWith('Speed 30 kn where ships here make'))).toBe(true);
  });

  it('keeps every score between 0 and 1', () => {
    const random = rng(11);
    const [[latA, lonA], [latB, lonB]] = TRAFFIC_DEFAULTS.training.bbox;
    const maybe = (value: number) => (random() < 0.2 ? null : value);
    for (let i = 0; i < 2000; i++) {
      const report: TrafficReport = {
        mmsi: 1 + Math.floor(random() * 50),
        at: START + Math.floor(random() * 600) * MINUTE,
        lat: latA - 0.01 + random() * (latB - latA + 0.02),
        lon: lonA - 0.01 + random() * (lonB - lonA + 0.02),
        sogKn: maybe(random() * 40),
        cogDeg: maybe(random() * 360),
        headingDeg: maybe(Math.floor(random() * 360)),
        aisClass: random() < 0.5 ? 'A' : 'B',
        navStatus: Math.floor(random() * 16),
      };
      const past = Array.from({ length: Math.floor(random() * 6) }, (_, k) => ({ ...report, at: report.at - (k + 1) * random() * 20 * MINUTE, sogKn: maybe(random() * 20) }));
      const result = scoreVessel(model, report, past, report.at + random() * 40 * MINUTE);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      for (const feature of result.features) {
        expect(Number.isFinite(feature.value)).toBe(true);
        expect(Number.isFinite(feature.z)).toBe(true);
        expect(feature.contribution).toBeGreaterThanOrEqual(0);
        expect(feature.contribution).toBeLessThanOrEqual(1);
      }
    }
  });

  it('remembers only the recent window of reports', () => {
    let kept: TrafficReport[] = [];
    for (const report of newcomer) kept = rememberReport(kept, report);
    const window = TRAFFIC_DEFAULTS.scoring.historyWindowMinutes * MINUTE;
    expect(kept[kept.length - 1]).toBe(newcomer[newcomer.length - 1]);
    expect(kept.every((report) => newcomer[newcomer.length - 1].at - report.at <= window)).toBe(true);
    expect(rememberReport(kept, newcomer[0])).toHaveLength(kept.length);
  });
});

describe('shipped traffic model', () => {
  const shipped = loadTrafficModel(shippedModelJson);

  it('loads with its sample size and scores a real position', () => {
    expect(shipped.meta.reports).toBeGreaterThan(0);
    expect(shipped.cells.length).toBeGreaterThan(0);
    const report: TrafficReport = {
      mmsi: 366760650,
      at: shipped.meta.toMs,
      lat: 33.7394,
      lon: -118.2087,
      sogKn: 8,
      cogDeg: 120,
      headingDeg: 121,
      aisClass: 'A',
    };
    const result = scoreVessel(shipped, report, [], report.at + 30_000);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.features.map((feature) => feature.key)).toEqual(['lane', 'heading', 'speed', 'gap', 'course']);
  });

  it('scores fast enough for every live vessel every few seconds', () => {
    const calls = 5000;
    const started = performance.now();
    for (let i = 0; i < calls; i++) scoreVessel(shipped, current, history, current.at + i);
    expect((performance.now() - started) / calls).toBeLessThan(0.5);
  });

  it('refuses a file that is not a traffic model', () => {
    expect(() => loadTrafficModel({ format: 'something else' })).toThrow();
    expect(() => loadTrafficModel({ ...shippedModelJson, version: 99 })).toThrow();
  });
});
