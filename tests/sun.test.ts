import { describe, expect, it } from 'vitest';
import { nextSunEvents, sunTimes } from '../src/engine/sun';

const HARBOR = { lat: 33.735, lon: -118.225 };
const TWO_MINUTES = 2 * 60_000;

function near(ms: number | null, iso: string): void {
  expect(ms).not.toBeNull();
  expect(Math.abs((ms as number) - Date.parse(iso))).toBeLessThan(TWO_MINUTES);
}

describe('sunrise and sunset for the harbor', () => {
  it('matches USNO for 17 October 2026', () => {
    const t = sunTimes(Date.parse('2026-10-17T13:00:00Z'), HARBOR.lat, HARBOR.lon);
    near(t.sunriseMs, '2026-10-17T14:00:00Z');
    near(t.sunsetMs, '2026-10-18T01:17:30Z');
    near(t.noonMs, '2026-10-17T19:38:00Z');
  });

  it('matches USNO at the June solstice', () => {
    const t = sunTimes(Date.parse('2026-06-21T15:00:00Z'), HARBOR.lat, HARBOR.lon);
    near(t.sunriseMs, '2026-06-21T12:43:00Z');
    near(t.sunsetMs, '2026-06-22T03:07:00Z');
  });

  it('keeps the same local day late in the evening', () => {
    const evening = sunTimes(Date.parse('2026-10-18T05:00:00Z'), HARBOR.lat, HARBOR.lon);
    near(evening.sunriseMs, '2026-10-17T14:00:00Z');
  });

  it('gives the next sunrise and the next sunset after now', () => {
    const afternoon = nextSunEvents(Date.parse('2026-10-17T20:00:00Z'), HARBOR.lat, HARBOR.lon);
    near(afternoon.sunriseMs, '2026-10-18T14:00:00Z');
    near(afternoon.sunsetMs, '2026-10-18T01:17:30Z');
    const night = nextSunEvents(Date.parse('2026-10-18T05:00:00Z'), HARBOR.lat, HARBOR.lon);
    near(night.sunriseMs, '2026-10-18T14:00:00Z');
    near(night.sunsetMs, '2026-10-19T01:16:30Z');
  });

  it('returns no sunrise or sunset in the polar night', () => {
    const t = sunTimes(Date.parse('2026-12-21T12:00:00Z'), 78.2, 15.6);
    expect(t.sunriseMs).toBeNull();
    expect(t.sunsetMs).toBeNull();
  });
});
