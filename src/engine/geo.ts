export type LonLat = [number, number];

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
const MPS_PER_KNOT = 0.514444;

export const knotsToMps = (kn: number): number => kn * MPS_PER_KNOT;
export const mpsToKnots = (mps: number): number => mps / MPS_PER_KNOT;

export function metersBetween(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LonLat, b: LonLat): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function offsetPoint(p: LonLat, meters: number, towardDeg: number): LonLat {
  const north = meters * Math.cos(towardDeg * RAD);
  const east = meters * Math.sin(towardDeg * RAD);
  const lat = p[1] + (north / EARTH_RADIUS_M) / RAD;
  const lon = p[0] + (east / (EARTH_RADIUS_M * Math.cos(p[1] * RAD))) / RAD;
  return [lon, lat];
}

export function circleRing(center: LonLat, radiusM: number, steps = 64): LonLat[] {
  const ring: LonLat[] = [];
  for (let k = 0; k <= steps; k++) ring.push(offsetPoint(center, radiusM, (360 * k) / steps));
  return ring;
}

export function lerpLonLat(a: LonLat, b: LonLat, f: number): LonLat {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

export function compassPoint(deg: number): string {
  const names = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${Math.round(m / 10) * 10} m`;
}

export function formatLatLon(ll: LonLat): string {
  return `${Math.abs(ll[1]).toFixed(4)} ${ll[1] >= 0 ? 'N' : 'S'} ${Math.abs(ll[0]).toFixed(4)} ${ll[0] >= 0 ? 'E' : 'W'}`;
}
