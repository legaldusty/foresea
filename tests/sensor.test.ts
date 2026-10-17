import { describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { findPath } from '../src/engine/grid';
import { bearingDeg, lerpLonLat, metersBetween, type LonLat } from '../src/engine/geo';
import { createWorld, type World } from '../src/engine/world';
import type { SensorDetection } from '../src/shared/protocol';
import { isLocalRequest, keysMatch, parseDetections, sensorAccess } from '../server/sensor';

const harbor = buildHarbor(gridJson as never, defaultSettings);
const T0 = 1_800_000_000_000;
const FIX_EVERY_SEC = 10;
const SPEED_MPS = 2;
const LIMITS = { maxBatch: defaultSettings.sensorFeed.maxBatch, maxIdLength: defaultSettings.sensorFeed.maxIdLength, bbox: defaultSettings.map.bbox };

function lonlatOf(cell: number): LonLat {
  return harbor.grid.toLonLat(...harbor.grid.xy(cell)) as LonLat;
}

function trackToFuel(): LonLat[] {
  const start = harbor.spawns[0];
  const fuel = harbor.targets.find((t) => t.id === 'fuel')!;
  const path = findPath(harbor.grid, start.cell, fuel.cell)!;
  const corners = path.filter((_, i) => i % 4 === 0).map(lonlatOf);
  const out: LonLat[] = [];
  const step = SPEED_MPS * FIX_EVERY_SEC;
  for (let k = 1; k < corners.length; k++) {
    const a = corners[k - 1], b = corners[k];
    const n = Math.max(1, Math.round(metersBetween(a, b) / step));
    for (let s = 0; s < n; s++) out.push(lerpLonLat(a, b, s / n));
  }
  return out;
}

function fixAt(lonlat: LonLat, k: number, heading: number, extra: Partial<SensorDetection> = {}): SensorDetection {
  return {
    sensorId: 'NULL-SIM-1', trackId: 'T7', time: new Date(T0 + k * FIX_EVERY_SEC * 1000).toISOString(),
    lon: lonlat[0], lat: lonlat[1], speedMps: SPEED_MPS, headingDeg: heading, sizeM: 2.5, heat: 'hot', pingReply: 'none', acousticDb: 118, depthM: 4, ...extra,
  };
}

function nightWorld(): World {
  const w = createWorld({ harbor, settings: defaultSettings });
  w.resetHarbor('night');
  w.setClock({ timeScale: 1 });
  return w;
}

function fuelOdds(w: World, contactId: string): number {
  const c = w.contacts.get(contactId)!;
  const g = harbor.targets.findIndex((t) => t.id === 'fuel');
  return c.tell.post[g];
}

describe('sensor feed into the world', () => {
  it('turns a straight track from Angels Gate into a contact that TELL calls for the Fuel Pier, then goes silent', () => {
    const w = nightWorld();
    const track = trackToFuel();
    expect(track.length).toBeGreaterThan(100);
    let contactId = '';
    let early = 0;
    for (let k = 0; k < track.length; k++) {
      const heading = k + 1 < track.length ? bearingDeg(track[k], track[k + 1]) : 0;
      const wall = T0 + k * FIX_EVERY_SEC * 1000;
      const r = w.ingestDetection(fixAt(track[k], k, heading), wall);
      expect(r.contactId).toBeTruthy();
      expect(r.status).toBe(k === 0 ? 'new' : 'updated');
      contactId = r.contactId!;
      w.tick(FIX_EVERY_SEC * 1000, wall + 1);
      if (k === 10) early = fuelOdds(w, contactId);
    }
    const c = w.contacts.get(contactId)!;
    expect(c.spec.mode).toBe('external');
    expect(w.contacts.size).toBe(1);
    const late = fuelOdds(w, contactId);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(0.5);
    const top = harbor.targets.reduce((best, _t, g) => (c.tell.post[g] > c.tell.post[best] ? g : best), 0);
    expect(harbor.targets[top].id).toBe('fuel');

    const view = w.commandSnapshot().contacts.find((v) => v.id === contactId)!;
    expect(view.mode).toBe('external');
    expect(view.sensor.simulated).toBe(false);
    expect(view.sensor.source).toBe('Sensor feed NULL-SIM-1');
    expect(view.sensor.acousticDb).toBe(118);
    expect(view.sensor.depthM).toBe(4);

    const lastWall = T0 + (track.length - 1) * FIX_EVERY_SEC * 1000;
    w.tick(1000, lastWall + (defaultSettings.sensorFeed.silentAfterSeconds - 2) * 1000);
    expect(w.contacts.get(contactId)!.silent).toBe(false);
    w.tick(1000, lastWall + (defaultSettings.sensorFeed.silentAfterSeconds + 2) * 1000);
    expect(w.contacts.get(contactId)!.silent).toBe(true);
    expect(w.commandSnapshot().contacts.find((v) => v.id === contactId)!.silent).toBe(true);
    expect(w.audit.some((a) => a.action === 'Sensor lost contact' && a.detail.includes(c.spec.label))).toBe(true);

    const back = w.ingestDetection(fixAt(track[track.length - 1], track.length + 3, 0), lastWall + 30_000);
    expect(back.status).toBe('updated');
    expect(w.contacts.get(contactId)!.silent).toBe(false);
  });

  it('ignores a fix older than the last one and keeps tracks from different sensors apart', () => {
    const w = nightWorld();
    const track = trackToFuel();
    w.ingestDetection(fixAt(track[0], 5, 0), T0);
    const stale = w.ingestDetection(fixAt(track[3], 2, 0), T0 + 1000);
    expect(stale.status).toBe('stale');
    const other = w.ingestDetection({ ...fixAt(track[0], 6, 0), sensorId: 'SONAR-2' }, T0 + 2000);
    expect(other.status).toBe('new');
    expect(w.contacts.size).toBe(2);
  });

  it('updates classification inputs from each fix', () => {
    const w = nightWorld();
    const track = trackToFuel();
    const first = w.ingestDetection(fixAt(track[0], 0, 0), T0);
    w.ingestDetection(fixAt(track[1], 1, 0, { sizeM: 18, heat: 'warm', speedMps: 1.4, pingReply: 'correct' }), T0 + 10_000);
    const c = w.contacts.get(first.contactId!)!;
    expect(c.spec.sizeM).toBe(18);
    expect(c.spec.heat).toBe('warm');
    expect(c.spec.speedMps).toBeCloseTo(1.4);
    expect(c.spec.reply).toBe('friendly');
  });
});

describe('detection parsing', () => {
  const good = { sensorId: 'NULL-SIM-1', trackId: 7, time: '2026-10-17T09:14:05Z', lat: 33.71, lon: -118.249 };

  it('takes one detection or an array, and turns a numeric track id into a string', () => {
    const one = parseDetections(good, LIMITS);
    expect(one.ok && one.detections[0].trackId).toBe('7');
    const many = parseDetections([good, { ...good, trackId: 'T8', heat: 'cold', pingReply: 'wrong', confidence: 0.4 }], LIMITS);
    expect(many.ok && many.detections.length).toBe(2);
  });

  it('rejects bad input with a message that names the field', () => {
    const cases: [unknown, RegExp][] = [
      [{ ...good, lat: undefined }, /lat is required/],
      [{ ...good, lat: 34.5 }, /outside the harbor chart/],
      [{ ...good, time: 'yesterday' }, /time is required/],
      [{ ...good, heat: 'boiling' }, /heat must be one of hot, warm, cold/],
      [{ ...good, sensorId: '' }, /sensorId is required/],
      [{ ...good, sensorId: 'a b' }, /sensorId may use only/],
      [{ ...good, confidence: 2 }, /confidence must be a number between 0 and 1/],
      [[good, 'x'], /detection 1: each detection must be a JSON object/],
      [[], /array is empty/],
      [Array.from({ length: LIMITS.maxBatch + 1 }, () => good), /at most/],
    ];
    for (const [body, message] of cases) {
      const r = parseDetections(body, LIMITS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(message);
    }
  });
});

describe('sensor access', () => {
  const local = { remoteAddress: '127.0.0.1', headers: {} };

  it('needs the matching key when GIVEWAY_SENSOR_KEY is set, from anywhere', () => {
    expect(sensorAccess({ configuredKey: 's3cret-key', providedKey: 's3cret-key', remoteAddress: '10.0.0.8', headers: {} }).ok).toBe(true);
    const wrong = sensorAccess({ configuredKey: 's3cret-key', providedKey: 'guess', ...local });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(401);
    expect(sensorAccess({ configuredKey: 's3cret-key', providedKey: undefined, ...local }).ok).toBe(false);
    expect(keysMatch('abc', 'abcd')).toBe(false);
  });

  it('accepts only this computer when no key is set, and not through a tunnel', () => {
    expect(sensorAccess({ configuredKey: undefined, providedKey: undefined, ...local }).ok).toBe(true);
    expect(sensorAccess({ configuredKey: '', providedKey: undefined, remoteAddress: '::1', headers: {} }).ok).toBe(true);
    const lan = sensorAccess({ configuredKey: undefined, providedKey: undefined, remoteAddress: '192.168.1.20', headers: {} });
    expect(lan.ok).toBe(false);
    if (!lan.ok) expect(lan.status).toBe(403);
    expect(isLocalRequest('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' })).toBe(false);
    expect(isLocalRequest('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })).toBe(false);
  });
});
