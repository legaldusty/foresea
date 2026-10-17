import trafficModelJson from '../../src/data/traffic_model.json';
import { loadTrafficModel, rememberReport, scoreVessel, trafficReportFromVessel, type TrafficReport } from '../../src/engine/traffic';
import type { AisVessel } from '../../src/shared/ais-types';
import type { VesselIntel } from '../../src/shared/protocol';
import type { ModelFacts } from '../../src/engine/world';

const HELD_OUT_FALSE_ALARM = 0.005;
const CATCHES_SILENCE = 0.942;
const CATCHES_LANE_STOP = 0.333;

export function createTrafficIntel() {
  const model = loadTrafficModel(trafficModelJson);
  const histories = new Map<number, TrafficReport[]>();
  const lastAt = new Map<number, number>();
  let runs: number[] = [];
  let lastRunMs: number | null = null;

  function facts(): NonNullable<ModelFacts['traffic']> {
    const meta = model.meta;
    const now = Date.now();
    runs = runs.filter((t) => now - t < 60_000);
    return {
      reports: meta.reports, vessels: meta.vessels, movingVessels: meta.movingVessels, movingReports: meta.movingReports,
      hours: meta.spanMinutes / 60, falseAlarm: HELD_OUT_FALSE_ALARM, catchesSilence: CATCHES_SILENCE, catchesLaneStop: CATCHES_LANE_STOP,
      trainedAt: meta.trainedAt, lastRunMs, runsPerMinute: runs.length,
    };
  }

  function score(vessels: AisVessel[], feedLive: boolean): Map<string, VesselIntel> {
    const out = new Map<string, VesselIntel>();
    if (!vessels.length) return out;
    const started = performance.now();
    const newest = Math.max(...vessels.map((v) => v.lastSeen));
    for (const v of vessels) {
      const report = trafficReportFromVessel(v);
      const prior = histories.get(v.mmsi) ?? [];
      if (lastAt.get(v.mmsi) !== report.at) {
        histories.set(v.mmsi, rememberReport(prior, report));
        lastAt.set(v.mmsi, report.at);
      }
      const history = (histories.get(v.mmsi) ?? []).filter((r) => r.at < report.at);
      const s = scoreVessel(model, report, history, feedLive ? newest : report.at);
      out.set(`ais-${v.mmsi}`, {
        score: s.score,
        level: s.level,
        reasons: s.reasons,
        features: s.features.map((f) => ({ label: f.label, value: `${Number.isInteger(f.value) ? f.value : f.value.toFixed(1)} ${f.unit}`.trim(), z: Number.isFinite(f.z) ? f.z : null })),
      });
    }
    for (const mmsi of [...histories.keys()]) if (!vessels.some((v) => v.mmsi === mmsi)) { histories.delete(mmsi); lastAt.delete(mmsi); }
    lastRunMs = performance.now() - started;
    runs.push(Date.now());
    return out;
  }

  return { score, facts };
}
