import 'dotenv/config';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { findPath, nearestWater } from '../src/engine/grid';
import { bearingDeg, lerpLonLat, metersBetween, offsetPoint, type LonLat } from '../src/engine/geo';
import { rng } from '../src/engine/bench';
import { INCIDENTS } from '../src/engine/scenarios';
import type { SensorDetection, SensorIngestResult } from '../src/shared/protocol';

const USAGE = 'Usage: npx tsx scripts/sensor-feed.ts <hub url> [--sensor NULL-SIM-1] [--track A1] [--every 1] [--speedup 1] [--max N] [--loop] [--key KEY]';
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const hubArg = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!hubArg || !/^https?:\/\//.test(hubArg)) {
  console.error(USAGE);
  process.exit(2);
}
const HUB = hubArg.replace(/\/$/, '');
const SENSOR = option('sensor', 'NULL-SIM-1');
const TRACK = option('track', 'A1');
const EVERY_SEC = Math.max(0.2, Number(option('every', '1')) || 1);
const SPEEDUP = Math.max(0.1, Number(option('speedup', '1')) || 1);
const LOOP = args.includes('--loop');
const MAX_FIXES = Number(option('max', '0')) || Infinity;
const KEY = option('key', process.env.GIVEWAY_SENSOR_KEY ?? '');
const SENSOR_NOISE_M = 3;
const CORNER_EVERY_CELLS = 4;

const incident = INCIDENTS.find((i) => i.key === 'A');
if (!incident) throw new Error('Incident A is missing from the scenarios');
const harbor = buildHarbor(gridJson as never, defaultSettings);
const goalId = 'goal' in incident.plan[0] ? incident.plan[0].goal : 'fuel';
const goal = harbor.targets.find((t) => t.id === goalId);
if (!goal) throw new Error(`No harbor target ${goalId}`);
const start: LonLat = [incident.lon, incident.lat];
const [sx, sy] = harbor.grid.toCell(start[0], start[1]);
const path = findPath(harbor.grid, nearestWater(harbor.grid, sx, sy, 8), goal.cell);
if (!path) throw new Error('No water path from the incident A start to its target');
const corners: LonLat[] = [start, ...path.filter((_, i) => i > 0 && (i % CORNER_EVERY_CELLS === 0 || i === path.length - 1)).map((cell) => harbor.grid.toLonLat(...harbor.grid.xy(cell)) as LonLat)];
const legs = corners.slice(1).map((b, k) => ({ a: corners[k], b, meters: metersBetween(corners[k], b) }));
const totalM = legs.reduce((s, l) => s + l.meters, 0);
const noise = rng(7);

function along(meters: number): { at: LonLat; headingDeg: number } {
  let left = meters;
  for (const leg of legs) {
    if (left <= leg.meters) return { at: lerpLonLat(leg.a, leg.b, leg.meters > 0 ? left / leg.meters : 1), headingDeg: bearingDeg(leg.a, leg.b) };
    left -= leg.meters;
  }
  const last = legs[legs.length - 1];
  return { at: last.b, headingDeg: bearingDeg(last.a, last.b) };
}

function detection(trackId: string, meters: number): SensorDetection {
  const { at, headingDeg } = along(meters);
  const seen = offsetPoint(at, noise() * SENSOR_NOISE_M, noise() * 360);
  const sizeM = incident!.size + (noise() - 0.5) * 0.2;
  const speedKn = incident!.speed / 0.514444;
  return {
    sensorId: SENSOR, trackId, time: new Date().toISOString(), lat: Number(seen[1].toFixed(6)), lon: Number(seen[0].toFixed(6)),
    depthM: Number((4 + (noise() - 0.5) * 0.6).toFixed(1)), speedMps: incident!.speed, headingDeg: Number(((headingDeg + (noise() - 0.5) * 4 + 360) % 360).toFixed(1)),
    sizeM: Number(sizeM.toFixed(2)), heat: 'hot', acousticDb: Math.round(112 + 1.6 * speedKn + 1.2 * sizeM), pingReply: 'none', confidence: 0.9,
  };
}

async function post(d: SensorDetection): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (KEY) headers['x-giveway-key'] = KEY;
  try {
    const res = await fetch(`${HUB}/api/sensor/detections`, { method: 'POST', headers, body: JSON.stringify(d) });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; results?: SensorIngestResult[] };
    if (!res.ok || !body.ok) return `refused (${res.status}): ${body.error ?? 'no reason given'}`;
    const r = body.results?.[0];
    return r ? `${r.status} ${r.contactId ?? ''}`.trim() : 'accepted';
  } catch (err) {
    return `hub unreachable: ${(err as Error).message}`;
  }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
let stopping = false;
process.on('SIGINT', () => { stopping = true; });

async function run(): Promise<void> {
  const stepM = incident!.speed * SPEEDUP * EVERY_SEC;
  const fixes = Math.min(MAX_FIXES, Math.ceil(totalM / stepM) + 1);
  console.log(`Sensor ${SENSOR} feeding incident A to ${HUB}: ${(totalM / 1000).toFixed(1)} km from outside Angels Gate to ${goal!.name}, ${fixes} fixes every ${EVERY_SEC} s at ${SPEEDUP}x.`);
  console.log(KEY ? 'Sending the x-giveway-key header.' : 'No key set; the hub must be on this computer.');
  for (let round = 1; !stopping; round++) {
    const trackId = round === 1 ? TRACK : `${TRACK}-${round}`;
    for (let k = 0; k < fixes && !stopping; k++) {
      const began = Date.now();
      const d = detection(trackId, Math.min(totalM, k * stepM));
      const outcome = await post(d);
      console.log(`${d.time.slice(11, 19)}  ${trackId}  fix ${String(k + 1).padStart(4)}/${fixes}  ${d.lat.toFixed(5)},${d.lon.toFixed(5)}  ${outcome}`);
      await sleep(Math.max(0, EVERY_SEC * 1000 - (Date.now() - began)));
    }
    if (!LOOP || stopping) break;
    console.log(`Track ${trackId} done. Starting again after the silence timeout.`);
    await sleep((defaultSettings.sensorFeed.silentAfterSeconds + 5) * 1000);
  }
  console.log(`Feed stopped. The hub marks the track silent after ${defaultSettings.sensorFeed.silentAfterSeconds} s without fixes.`);
}

await run();
