import gridJson from '../../data/harbor_grid.json';
import { defaultSettings } from '../../engine/settings';
import { buildHarbor } from '../../engine/harbor';
import { runNights, benchAcceptance } from '../../engine/bench';

export interface NightsRequest { nights: number; seed: number }

export interface NightsProgress { type: 'progress'; phase: 'gates' | 'closeIn'; fraction: number }

export interface NightsResult {
  type: 'result';
  nights: number;
  seed: number;
  ms: number;
  gates: ReturnType<typeof runNights>;
  closeIn: ReturnType<typeof runNights>;
  acceptance: ReturnType<typeof benchAcceptance>;
}

const harbor = buildHarbor(gridJson as never, defaultSettings);

self.onmessage = (e: MessageEvent<NightsRequest>) => {
  const { nights, seed } = e.data;
  const started = performance.now();
  const post = (m: NightsProgress | NightsResult) => (self as unknown as Worker).postMessage(m);
  const gates = runNights(harbor, { nights, seed, nearness: true, detection: 'gates', onProgress: (f: number) => post({ type: 'progress', phase: 'gates', fraction: f }) });
  const closeIn = runNights(harbor, { nights, seed, nearness: true, detection: 'closeIn', onProgress: (f: number) => post({ type: 'progress', phase: 'closeIn', fraction: f }) });
  post({ type: 'result', nights, seed, ms: performance.now() - started, gates, closeIn, acceptance: benchAcceptance(gates) });
};
