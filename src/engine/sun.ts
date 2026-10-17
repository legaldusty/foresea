const DAY_MS = 86_400_000;
const UNIX_EPOCH_JULIAN_DAY = 2440587.5;
const J2000 = 2451545.0;
const RAD = Math.PI / 180;
const MEAN_ANOMALY_AT_J2000_DEG = 357.5291;
const MEAN_ANOMALY_DEG_PER_DAY = 0.98560028;
const EQUATION_OF_CENTER_DEG = [1.9148, 0.02, 0.0003];
const PERIHELION_LONGITUDE_DEG = 102.9372;
const TRANSIT_ANOMALY_TERM = 0.0053;
const TRANSIT_ECLIPTIC_TERM = -0.0069;
const OBLIQUITY_DEG = 23.4397;
const HORIZON_ALTITUDE_DEG = -0.833;

export interface SunTimes { sunriseMs: number | null; sunsetMs: number | null; noonMs: number }

export interface NextSun { sunriseMs: number | null; sunsetMs: number | null }

const julianDay = (ms: number): number => ms / DAY_MS + UNIX_EPOCH_JULIAN_DAY;
const msOfJulianDay = (jd: number): number => (jd - UNIX_EPOCH_JULIAN_DAY) * DAY_MS;
const wrapDeg = (deg: number): number => ((deg % 360) + 360) % 360;

export function solarDayIndex(ms: number, lonDeg: number): number {
  return Math.round(julianDay(ms) - J2000 + lonDeg / 360);
}

export function sunTimesForDay(dayIndex: number, latDeg: number, lonDeg: number): SunTimes {
  const meanNoon = dayIndex - lonDeg / 360;
  const anomaly = wrapDeg(MEAN_ANOMALY_AT_J2000_DEG + MEAN_ANOMALY_DEG_PER_DAY * meanNoon) * RAD;
  const center = EQUATION_OF_CENTER_DEG.reduce((sum, k, i) => sum + k * Math.sin((i + 1) * anomaly), 0);
  const ecliptic = wrapDeg(anomaly / RAD + center + 180 + PERIHELION_LONGITUDE_DEG) * RAD;
  const transit = J2000 + meanNoon + TRANSIT_ANOMALY_TERM * Math.sin(anomaly) + TRANSIT_ECLIPTIC_TERM * Math.sin(2 * ecliptic);
  const sinDeclination = Math.sin(ecliptic) * Math.sin(OBLIQUITY_DEG * RAD);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const lat = latDeg * RAD;
  const cosHourAngle = (Math.sin(HORIZON_ALTITUDE_DEG * RAD) - Math.sin(lat) * sinDeclination) / (Math.cos(lat) * cosDeclination);
  const noonMs = msOfJulianDay(transit);
  if (!Number.isFinite(cosHourAngle) || cosHourAngle > 1 || cosHourAngle < -1) return { sunriseMs: null, sunsetMs: null, noonMs };
  const halfDay = Math.acos(cosHourAngle) / RAD / 360;
  return { sunriseMs: msOfJulianDay(transit - halfDay), sunsetMs: msOfJulianDay(transit + halfDay), noonMs };
}

export function sunTimes(ms: number, latDeg: number, lonDeg: number): SunTimes {
  return sunTimesForDay(solarDayIndex(ms, lonDeg), latDeg, lonDeg);
}

export function nextSunEvents(ms: number, latDeg: number, lonDeg: number): NextSun {
  const today = solarDayIndex(ms, lonDeg);
  const days = [today - 1, today, today + 1, today + 2].map((d) => sunTimesForDay(d, latDeg, lonDeg));
  const firstAfter = (pick: (t: SunTimes) => number | null) => days.map(pick).find((t): t is number => t !== null && t > ms) ?? null;
  return { sunriseMs: firstAfter((t) => t.sunriseMs), sunsetMs: firstAfter((t) => t.sunsetMs) };
}
