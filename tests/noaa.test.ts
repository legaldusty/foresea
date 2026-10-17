import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import settings from '../settings/giveway.settings.json';
import {
  createNoaaClient,
  currentAt,
  currentVector,
  parseNoaaTime,
  predictionSample,
  vectorToSpeedToward,
  writePayload,
  type CurrentSeries,
  type FetchLike,
  type NoaaPayload,
  type NoaaSettings,
} from '../server/noaa/client';

const noaaSettings = settings as unknown as NoaaSettings;
const NOW = Date.parse('2026-10-17T06:30:00Z');

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const offlineFetch: FetchLike = () => Promise.reject(new TypeError('fetch failed'));

const onlineFetch: FetchLike = (url) => {
  if (url.includes('product=currents_predictions')) {
    return jsonResponse({
      current_predictions: {
        units: 'meters, cm/s',
        cp: [
          { Speed: '10.0', Bin: '6', Time: '2026-10-17 06:20', Direction: 90, Depth: '10.7' },
          { Speed: '10.0', Bin: '6', Time: '2026-10-17 06:40', Direction: 0, Depth: '10.7' },
        ],
      },
    });
  }
  if (url.includes('product=currents')) return jsonResponse({ error: { message: 'No data was found.' } });
  if (url.includes('product=water_level')) {
    return jsonResponse({ metadata: { id: '9410660', name: 'Los Angeles' }, data: [{ t: '2026-10-17 06:24', v: '0.782' }] });
  }
  if (url.includes('/stations/lb0101.json')) return jsonResponse({ stations: [{ id: 'lb0101', name: 'Queens Gate' }] });
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
};

const snapshot: NoaaPayload = {
  fetchedAt: '2026-10-17T06:00:00.000Z',
  current: {
    station: 'lb0101',
    stationName: 'Queens Gate',
    basis: 'predicted',
    depthM: 10.7,
    samples: [
      { at: '2026-10-17T06:00:00.000Z', speedMps: 0.2, towardDeg: 180 },
      { at: '2026-10-17T07:00:00.000Z', speedMps: 0.2, towardDeg: 180 },
    ],
  },
  waterLevel: { station: '9410660', stationName: 'Los Angeles', meters: 0.81, datum: 'MLLW', observedAt: '2026-10-17T05:54:00.000Z' },
};

describe('current vectors', () => {
  it('splits speed and toward direction into east and north parts', () => {
    const north = currentVector(1, 0);
    expect(north.u).toBeCloseTo(0);
    expect(north.v).toBeCloseTo(1);
    const east = currentVector(1, 90);
    expect(east.u).toBeCloseTo(1);
    expect(east.v).toBeCloseTo(0);
    const southwest = currentVector(0.5, 225);
    expect(southwest.u).toBeCloseTo(-0.35355, 4);
    expect(southwest.v).toBeCloseTo(-0.35355, 4);
    const real = currentVector(0.057, 242);
    expect(real.u).toBeCloseTo(-0.0503, 3);
    expect(real.v).toBeCloseTo(-0.0268, 3);
  });

  it('turns u and v back into speed and toward direction', () => {
    const back = vectorToSpeedToward(-0.35355, -0.35355);
    expect(back.speedMps).toBeCloseTo(0.5, 4);
    expect(back.towardDeg).toBeCloseTo(225, 3);
    expect(vectorToSpeedToward(0, 0)).toEqual({ speedMps: 0, towardDeg: 0 });
  });

  it('reads NOAA prediction rows in cm/s, both speed and direction and major axis forms', () => {
    expect(predictionSample({ Time: '2026-10-17 06:27', Speed: '5.275', Direction: 238 })).toEqual({
      at: '2026-10-17T06:27:00.000Z', speedMps: expect.closeTo(0.05275, 9), towardDeg: 238,
    });
    expect(predictionSample({ Time: '2026-10-17 00:00', Velocity_Major: -2.3, meanFloodDir: 48, meanEbbDir: 257 })).toEqual({
      at: '2026-10-17T00:00:00.000Z', speedMps: expect.closeTo(0.023, 9), towardDeg: 257,
    });
    expect(predictionSample({ Time: '2026-10-17 00:00', Velocity_Major: 4, meanFloodDir: 48, meanEbbDir: 257 })?.towardDeg).toBe(48);
  });

  it('parses NOAA GMT times', () => {
    expect(parseNoaaTime('2026-10-17 06:18')).toBe(Date.parse('2026-10-17T06:18:00Z'));
  });

  it('blends predictions through u and v between samples', () => {
    const series: CurrentSeries = {
      station: 'lb0101', stationName: 'Queens Gate', basis: 'predicted', depthM: null,
      samples: [
        { at: '2026-10-17T06:00:00.000Z', speedMps: 0.1, towardDeg: 90 },
        { at: '2026-10-17T07:00:00.000Z', speedMps: 0.1, towardDeg: 270 },
      ],
    };
    const quarter = currentAt(series, Date.parse('2026-10-17T06:15:00Z'));
    expect(quarter.speedMps).toBeCloseTo(0.05);
    expect(quarter.towardDeg).toBeCloseTo(90);
    expect(currentAt(series, Date.parse('2026-10-18T00:00:00Z')).towardDeg).toBe(270);
  });
});

describe('NOAA client', () => {
  let dir: string;
  let cacheFile: string;
  let snapshotFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giveway-noaa-'));
    cacheFile = path.join(dir, 'cache', 'noaa.json');
    snapshotFile = path.join(dir, 'noaa-snapshot.json');
    writePayload(snapshotFile, snapshot);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the committed snapshot when offline', async () => {
    const client = createNoaaClient({ settings: noaaSettings, fetch: offlineFetch, cacheFile, snapshotFile, now: () => NOW });
    const current = await client.getCurrent();
    expect(current?.source).toBe('snapshot');
    expect(current?.basis).toBe('predicted');
    expect(current?.station).toBe('lb0101');
    expect(current?.speedMps).toBeCloseTo(0.2);
    expect(current?.towardDeg).toBeCloseTo(180);
    expect(current?.u).toBeCloseTo(0);
    expect(current?.v).toBeCloseTo(-0.2);
    expect(current?.fetchedAt).toBe(snapshot.fetchedAt);
    const level = await client.getWaterLevel();
    expect(level?.source).toBe('snapshot');
    expect(level?.meters).toBe(0.81);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it('returns null when offline with no cache and no snapshot', async () => {
    const client = createNoaaClient({ settings: noaaSettings, fetch: offlineFetch, cacheFile, snapshotFile: path.join(dir, 'missing.json'), now: () => NOW });
    expect(await client.getCurrent()).toBeNull();
  });

  it('fetches live, uses predictions when no observation exists, and caches', async () => {
    const client = createNoaaClient({ settings: noaaSettings, fetch: onlineFetch, cacheFile, snapshotFile, now: () => NOW });
    const current = await client.getCurrent();
    expect(current?.source).toBe('live');
    expect(current?.basis).toBe('predicted');
    expect(current?.stationName).toBe('Queens Gate');
    expect(current?.speedMps).toBeCloseTo(Math.SQRT1_2 * 0.1, 4);
    expect(current?.towardDeg).toBeCloseTo(45, 3);
    const level = await client.getWaterLevel();
    expect(level).toMatchObject({ source: 'live', meters: 0.782, station: '9410660', stationName: 'Los Angeles', datum: 'MLLW' });
    expect(fs.existsSync(cacheFile)).toBe(true);

    const cachedClient = createNoaaClient({ settings: noaaSettings, fetch: offlineFetch, cacheFile, snapshotFile, now: () => NOW + 60_000 });
    expect((await cachedClient.getCurrent())?.source).toBe('cache');
  });

  it('prefers a stale cache over the snapshot when offline', async () => {
    writePayload(cacheFile, { ...snapshot, fetchedAt: '2026-10-16T00:00:00.000Z' });
    const client = createNoaaClient({ settings: noaaSettings, fetch: offlineFetch, cacheFile, snapshotFile, now: () => NOW });
    expect((await client.getWaterLevel())?.source).toBe('cache');
  });
});
