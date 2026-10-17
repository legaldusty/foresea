import gridJson from '../../data/harbor_grid.json';
import { defaultSettings } from '../../engine/settings';
import { buildHarbor } from '../../engine/harbor';
import { runNights, benchAcceptance } from '../../engine/bench';
import { runCalibration, type CalibrationPhase, type CalibrationResult } from '../../engine/calibration';

export interface NightsRequest { nights: number; seed: number }

export interface NightsProgress { type: 'progress'; phase: 'gates' | 'closeIn' | CalibrationPhase; fraction: number }

export interface NightsResult {
  type: 'result';
  nights: number;
  seed: number;
  ms: number;
  gates: ReturnType<typeof runNights>;
  closeIn: ReturnType<typeof runNights>;
  acceptance: ReturnType<typeof benchAcceptance>;
  calibration: CalibrationResult | null;
}

const harbor = buildHarbor(gridJson as never, defaultSettings);

self.onmessage = (e: MessageEvent<NightsRequest>) => {
  const { nights, seed } = e.data;
  const started = performance.now();
  const post = (m: NightsProgress | NightsResult) => (self as unknown as Worker).postMessage(m);
  const gates = runNights(harbor, { nights, seed, nearness: true, detection: 'gates', onProgress: (f: number) => post({ type: 'progress', phase: 'gates', fraction: f }) });
  const closeIn = runNights(harbor, { nights, seed, nearness: true, detection: 'closeIn', onProgress: (f: number) => post({ type: 'progress', phase: 'closeIn', fraction: f }) });
  const bench: NightsResult = { type: 'result', nights, seed, ms: performance.now() - started, gates, closeIn, acceptance: benchAcceptance(gates), calibration: null };
  post(bench);
  const calibrationStarted = performance.now();
  const study = runCalibration(harbor, { nights, seed, onProgress: (phase, fraction) => post({ type: 'progress', phase, fraction }) });
  post({ ...bench, calibration: { ...study, ms: performance.now() - calibrationStarted } });
};
