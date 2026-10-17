export type LonLat = [number, number];

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

export function distanceMeters(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function breakwaterLatitudeAt(lon: number, line: number[][]): number | null {
  for (let i = 0; i < line.length - 1; i++) {
    const [lonA, latA] = line[i];
    const [lonB, latB] = line[i + 1];
    const west = Math.min(lonA, lonB);
    const east = Math.max(lonA, lonB);
    if (lon < west || lon > east) continue;
    const span = lonB - lonA;
    const f = span === 0 ? 0 : (lon - lonA) / span;
    return latA + (latB - latA) * f;
  }
  return null;
}

export function isInsideBreakwater(point: LonLat, line: number[][]): boolean {
  const lat = breakwaterLatitudeAt(point[0], line);
  return lat !== null && point[1] > lat;
}
