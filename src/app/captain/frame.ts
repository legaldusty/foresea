import type { CaptainNotice } from '../../shared/protocol';
import { metersBetween, offsetPoint, type LonLat } from '../../engine/geo';

const ROUTE_AHEAD_M = 4000;
const BOAT_BOX_M = 600;

function outerRings(rings: LonLat[][][]): LonLat[] {
  return rings.flatMap((poly) => poly[0] ?? []);
}

export function noticePoints(n: CaptainNotice): LonLat[] {
  if (n.area && (n.area.likely.length || n.area.careful.length)) {
    return [...outerRings(n.area.careful), ...outerRings(n.area.likely), ...n.area.ticks.map((t) => t.lonlat)];
  }
  return outerRings(n.zone.rings);
}

export function routeAhead(route: LonLat[] | null, maxM = ROUTE_AHEAD_M): LonLat[] {
  if (!route?.length) return [];
  const out: LonLat[] = [route[0]];
  let run = 0;
  for (let i = 1; i < route.length; i++) {
    run += metersBetween(route[i - 1], route[i]);
    out.push(route[i]);
    if (run >= maxM) break;
  }
  return out;
}

export function boatBox(at: LonLat, meters = BOAT_BOX_M): LonLat[] {
  return [0, 90, 180, 270].map((deg) => offsetPoint(at, meters, deg));
}

export function framePoints(boat: LonLat | null, route: LonLat[] | null, notices: CaptainNotice[]): LonLat[] {
  const pts: LonLat[] = [...routeAhead(route), ...notices.flatMap(noticePoints)];
  if (boat) pts.push(boat);
  if (boat && pts.length < 3) pts.push(...boatBox(boat));
  return pts;
}

export function formatLatLon(p: LonLat): string {
  const [lon, lat] = p;
  return `${Math.abs(lat).toFixed(4)} ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)} ${lon >= 0 ? 'E' : 'W'}`;
}
