import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import settings from '../settings/giveway.settings.json';
import { buoyReading, parseNdbcRealtime } from '../server/conditions/ndbc';
import { levelTrend, nextTurns, parseLatestValue, parseLevelSeries, parseTideTurns, parseWind } from '../server/conditions/coops';
import { advisorySummary, parseAlerts, parseZoneForecast } from '../server/conditions/nws';
import { createConditionsClient, type ConditionsSettings } from '../server/conditions/client';
import type { TextFetch } from '../server/conditions/http';
import { repoPath } from './support';

const NOW = Date.parse('2026-10-17T13:00:00Z');
const fixture = (name: string) => fs.readFileSync(repoPath(`tests/fixtures/${name}`), 'utf8');
const fixtureJson = (name: string) => JSON.parse(fixture(name)) as unknown;
const conditionsSettings = settings as unknown as ConditionsSettings;

describe('NDBC realtime2 text', () => {
  it('reads wave height, period, direction and water temperature, with MM as missing', () => {
    const rows = parseNdbcRealtime(fixture('ndbc-46222.txt'));
    expect(rows.length).toBe(8);
    expect(new Date(rows[0].at).toISOString()).toBe('2026-10-17T12:26:00.000Z');
    expect(rows[0].values.WVHT).toBe(0.6);
    expect(rows[0].values.DPD).toBe(14);
    expect(rows[0].values.MWD).toBe(198);
    expect(rows[0].values.WTMP).toBe(22.9);
    expect(rows[0].values.WSPD).toBeNull();
    expect(rows[0].values.PRES).toBeNull();
  });

  it('takes the newest row that has each value', () => {
    const text = fixture('ndbc-46222.txt').replace('2026 10 17 12 26  MM   MM   MM   0.6    14   9.0 198     MM    MM  22.9', '2026 10 17 12 26  MM   MM   MM    MM    14   9.0 198     MM    MM    MM');
    const reading = buoyReading('46222', 'San Pedro', parseNdbcRealtime(text), NOW, 180);
    expect(reading.waveHeightM).toEqual({ value: 0.6, at: '2026-10-17T11:56:00.000Z' });
    expect(reading.waterTempC).toEqual({ value: 23.0, at: '2026-10-17T11:56:00.000Z' });
    expect(reading.dominantPeriodS).toEqual({ value: 14, at: '2026-10-17T12:26:00.000Z' });
  });

  it('ignores rows older than the max age', () => {
    const reading = buoyReading('46222', 'San Pedro', parseNdbcRealtime(fixture('ndbc-46222.txt')), NOW + 6 * 3_600_000, 180);
    expect(reading.waveHeightM).toBeNull();
    expect(reading.waterTempC).toBeNull();
  });

  it('refuses a file without the header row', () => {
    expect(() => parseNdbcRealtime('<html>Not found</html>')).toThrow(/header/);
  });
});

describe('NOAA CO-OPS JSON', () => {
  it('reads wind speed, gust and direction from Angels Gate', () => {
    expect(parseWind(fixtureJson('coops-wind-9410647.json'), '9410647')).toEqual({
      station: '9410647', stationName: 'Angels Gate', speedMps: 2.6, gustMps: 3.2, fromDeg: 358, at: '2026-10-17T12:48:00.000Z',
    });
  });

  it('reads air temperature and pressure', () => {
    expect(parseLatestValue(fixtureJson('coops-air-temperature-9410647.json'), '9410647')?.value).toBe(26.8);
    expect(parseLatestValue(fixtureJson('coops-air-pressure-9410660.json'), '9410660')).toMatchObject({ stationName: 'Los Angeles', value: 1015.4 });
  });

  it('turns the no-data answer into a readable reason', () => {
    expect(() => parseWind(fixtureJson('coops-no-data-9410660-wind.json'), '9410660')).toThrow('station 9410660: No data was found');
  });

  it('reads the water level series and its trend', () => {
    const series = parseLevelSeries(fixtureJson('coops-water-level-9410660.json'), '9410660');
    expect(series.samples.length).toBe(9);
    expect(series.samples[series.samples.length - 1].meters).toBe(1.35);
    expect(levelTrend(series.samples, 30, 0.02)).toBe('steady');
    expect(levelTrend(series.samples, 60, 0.02)).toBe('rising');
    expect(levelTrend(series.samples.slice(0, 1), 30, 0.02)).toBeNull();
  });

  it('finds the next high and next low tide', () => {
    const turns = parseTideTurns(fixtureJson('coops-hilo-9410660.json'), '9410660');
    expect(turns.length).toBe(6);
    const next = nextTurns(turns, NOW);
    expect(next.high).toEqual({ kind: 'high', at: '2026-10-17T20:23:00.000Z', meters: 1.361 });
    expect(next.low).toEqual({ kind: 'low', at: '2026-10-18T05:33:00.000Z', meters: 0.301 });
  });
});

describe('NWS alerts and zone forecast', () => {
  it('reads the Small Craft Advisory for PZZ655 with a key that survives updates', () => {
    const list = parseAlerts(fixtureJson('nws-alerts-pzz655.json'), NOW);
    expect(list.length).toBe(1);
    const a = list[0];
    expect(a.id).toBe('KLOX.SC.Y.0149');
    expect(a.event).toBe('Small Craft Advisory');
    expect(a.severity).toBe('Minor');
    expect(Date.parse(a.ends as string)).toBe(Date.parse('2026-10-17T21:00:00Z'));
    expect(a.onset).toBe('2026-10-17T04:48:00-07:00');
    expect(a.areaDesc).toContain('Inner waters from Point Mugu to San Mateo Pt.');
    expect(a.summary).toBe('Hazardous sea conditions. Conditions will be hazardous to small craft.');
    expect(a.sender).toBe('NWS Los Angeles/Oxnard CA');
  });

  it('drops an advisory once it has ended, and drops cancellations', () => {
    expect(parseAlerts(fixtureJson('nws-alerts-pzz655.json'), Date.parse('2026-10-17T21:30:00Z'))).toEqual([]);
    const body = fixtureJson('nws-alerts-pzz655.json') as { features: { properties: { messageType: string } }[] };
    body.features[0].properties.messageType = 'Cancel';
    expect(parseAlerts(body, NOW)).toEqual([]);
  });

  it('falls back to the instruction when the description has no WHAT or IMPACTS', () => {
    expect(advisorySummary({ description: 'Seas building.', instruction: 'Stay\nin port.' })).toBe('Stay in port.');
  });

  it('keeps the first two forecast periods and ignores an issue time from the future', () => {
    const f = parseZoneForecast(fixtureJson('nws-zone-forecast-pzz655.json'), 2, NOW);
    expect(f?.periods.map((p) => p.name)).toEqual(['Today', 'Tonight']);
    expect(f?.periods[1].text).toContain('Seas 2 to 3 ft');
    expect(f?.issuedAt).toBeNull();
    expect(parseZoneForecast(fixtureJson('nws-zone-forecast-pzz655.json'), 2, Date.parse('2026-10-17T20:00:00Z'))?.issuedAt).toBe('2026-10-17T12:48:00-07:00');
  });
});

function reply(body: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) });
}

const fixtureFetch: TextFetch = (url) => {
  if (url.includes('/realtime2/46222.txt')) return reply(fixture('ndbc-46222.txt'));
  if (url.includes('/realtime2/46253.txt')) return reply('', 503);
  if (url.includes('product=water_level')) return reply(fixture('coops-water-level-9410660.json'));
  if (url.includes('product=predictions')) return reply(fixture('coops-hilo-9410660.json'));
  if (url.includes('product=wind') && url.includes('station=9410647')) return reply(fixture('coops-wind-9410647.json'));
  if (url.includes('product=air_temperature') && url.includes('station=9410647')) return reply(fixture('coops-air-temperature-9410647.json'));
  if (url.includes('product=air_pressure') && url.includes('station=9410660')) return reply(fixture('coops-air-pressure-9410660.json'));
  if (url.includes('/alerts/active?zone=PZZ655')) return reply(fixture('nws-alerts-pzz655.json'));
  if (url.includes('/zones/forecast/PZZ655/forecast')) return reply(fixture('nws-zone-forecast-pzz655.json'));
  return reply(fixture('coops-no-data-9410660-wind.json'));
};

const offlineFetch: TextFetch = () => Promise.reject(new TypeError('fetch failed'));

describe('conditions client', () => {
  let dir: string;
  let cacheFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giveway-conditions-'));
    cacheFile = path.join(dir, 'conditions.json');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('builds a view where every value carries its source and age', async () => {
    const client = createConditionsClient({ settings: conditionsSettings, fetch: fixtureFetch, cacheFile, now: () => NOW });
    await client.refresh();
    const v = client.view();
    expect(v.waterLevelM).toMatchObject({ value: 1.35, source: 'CO-OPS 9410660 Los Angeles, observed', observedAt: '2026-10-17T12:48:00.000Z', ageMin: 12 });
    expect(v.tideTrend?.value).toBe('steady');
    expect(v.nextHigh?.value).toMatchObject({ kind: 'high', at: '2026-10-17T20:23:00.000Z' });
    expect(v.windMps).toMatchObject({ value: 2.6, source: 'CO-OPS 9410647 Angels Gate wind' });
    expect(v.gustMps?.value).toBe(3.2);
    expect(v.windFromDeg?.value).toBe(358);
    expect(v.waveHeightM).toMatchObject({ value: 0.6, source: 'NDBC 46222 San Pedro', ageMin: 34 });
    expect(v.waterTempC?.value).toBe(22.9);
    expect(v.airTempC?.value).toBe(26.8);
    expect(v.pressureHpa?.value).toBe(1015.4);
    expect(v.advisories?.value.map((a) => a.event)).toEqual(['Small Craft Advisory']);
    expect(v.forecast?.value.periods.length).toBe(2);
    const south = v.sources.find((s) => s.id === 'buoy:46253');
    expect(south).toMatchObject({ ok: false, detail: 'answered HTTP 503' });
    expect(fs.existsSync(cacheFile)).toBe(true);
  });

  it('falls back to the second wind station when the first has no data', async () => {
    const fetchWithoutAngelsGate: TextFetch = (url, init) => (url.includes('product=wind') && url.includes('station=9410647') ? reply(fixture('coops-no-data-9410660-wind.json')) : url.includes('product=wind') && url.includes('station=9410666') ? reply(fixture('coops-wind-9410647.json').replace('9410647', '9410666').replace('Angels Gate', 'Los Angeles Pier 400')) : fixtureFetch(url, init));
    const client = createConditionsClient({ settings: conditionsSettings, fetch: fetchWithoutAngelsGate, cacheFile, now: () => NOW });
    await client.refresh(['met']);
    expect(client.view().windMps?.source).toBe('CO-OPS 9410666 Los Angeles Pier 400 wind');
  });

  it('says No data with the reason and the age of the last good value when a source fails', async () => {
    let now = NOW;
    let fetchImpl: TextFetch = fixtureFetch;
    const client = createConditionsClient({ settings: conditionsSettings, fetch: (u, i) => fetchImpl(u, i), cacheFile, now: () => now });
    await client.refresh();
    fetchImpl = offlineFetch;
    now = NOW + 4 * 3_600_000;
    await client.refresh();
    const v = client.view();
    expect(v.windMps).toBeNull();
    expect(v.missing.wind).toContain('unreachable (fetch failed)');
    expect(v.missing.wind).toContain('Last good 4 h ago');
    expect(v.advisories).toBeNull();
    expect(v.missing.advisories).toMatch(/^No data\. NWS alerts PZZ655: unreachable/);
    expect(v.waveHeightM).toBeNull();
    expect(v.missing.waveHeight).toContain('No buoy answered');
    expect(v.sources.every((s) => !s.ok)).toBe(true);
  });

  it('starts from the cache file and labels it as cached', async () => {
    const first = createConditionsClient({ settings: conditionsSettings, fetch: fixtureFetch, cacheFile, now: () => NOW });
    await first.refresh();
    const second = createConditionsClient({ settings: conditionsSettings, fetch: offlineFetch, cacheFile, now: () => NOW + 5 * 60_000 });
    const v = second.view();
    expect(v.windMps?.value).toBe(2.6);
    expect(v.windMps?.ageMin).toBe(17);
    expect(v.sources.find((s) => s.id === 'wind')?.detail).toBe('From the cache file, fetched 5 min ago');
  });

  it('stays quiet about a source that never answered', async () => {
    const client = createConditionsClient({ settings: conditionsSettings, fetch: offlineFetch, cacheFile, now: () => NOW });
    await client.refresh();
    const v = client.view();
    expect(v.waterLevelM).toBeNull();
    expect(v.nextHigh).toBeNull();
    expect(v.forecast).toBeNull();
    expect(v.missing.waterLevel).toBe('CO-OPS 9410660 tide: unreachable (fetch failed)');
  });
});
