import type { CaptainSnapshot, CommandSnapshot, ContactView, ZoneView } from '../../shared/protocol';
import { bearingDeg, offsetPoint, type LonLat } from '../../engine/geo';
import { silhouetteFor } from './chartImages';
import { EMPTY, type ChartData } from './ChartMap';

type F = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

const fc = (features: F[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

function zoneFeatures(zones: Pick<ZoneView, 'id' | 'kind' | 'status' | 'rings'>[]): F[] {
  return zones.filter((z) => z.rings.length).map((z) => ({
    type: 'Feature', properties: { id: z.id, kind: z.kind, status: z.status },
    geometry: { type: 'MultiPolygon', coordinates: z.rings },
  }));
}

function arrowFeatures(zones: { id: string; kind: string; centerline: LonLat[]; movingTowardDeg: number | null; movingSpeedMps: number }[]): F[] {
  const out: F[] = [];
  for (const z of zones) {
    if (z.movingTowardDeg === null || z.movingSpeedMps <= 0 || !z.centerline.length) continue;
    const start = z.centerline[0];
    const meters = Math.max(300, z.movingSpeedMps * 300);
    const end = offsetPoint(start, meters, z.movingTowardDeg);
    out.push({ type: 'Feature', properties: { kind: z.kind }, geometry: { type: 'LineString', coordinates: [start, end] } });
    out.push({ type: 'Feature', properties: { kind: z.kind, bearing: z.movingTowardDeg }, geometry: { type: 'Point', coordinates: end } });
  }
  return out;
}

export function contactState(c: ContactView): string {
  switch (c.classification.kind) {
    case 'friendly': return 'friendly';
    case 'debris': return 'debris';
    case 'animal': return 'animal';
    case 'person': return 'person';
  }
  if (!c.risk) return 'unknown';
  return c.risk.level.toLowerCase();
}

function lineWithHead(coords: LonLat[], props: Record<string, unknown>): F[] {
  if (coords.length < 2) return [];
  const a = coords[coords.length - 2], b = coords[coords.length - 1];
  return [
    { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } },
    { type: 'Feature', properties: { ...props, bearing: bearingDeg(a, b) }, geometry: { type: 'Point', coordinates: b } },
  ];
}

export function commandChart(s: CommandSnapshot | null, selectedId: string | null): ChartData {
  if (!s) return { zones: EMPTY, paths: EMPTY, routes: EMPTY, vessels: EMPTY, contacts: EMPTY, arrows: EMPTY, you: EMPTY };
  const paths: F[] = [];
  for (const c of s.contacts) {
    if (c.track.length > 1) paths.push({ type: 'Feature', properties: { kind: 'track', rank: 9 }, geometry: { type: 'LineString', coordinates: c.track } });
  }
  const routes: F[] = [];
  for (const v of s.vessels) {
    if (v.route) routes.push({ type: 'Feature', properties: { kind: 'planned', id: v.id }, geometry: { type: 'LineString', coordinates: v.route } });
    if (v.newRoute) routes.push({ type: 'Feature', properties: { kind: 'new', id: v.id }, geometry: { type: 'LineString', coordinates: v.newRoute } });
  }
  const vessels: F[] = s.vessels.map((v) => ({
    type: 'Feature',
    properties: {
      id: v.id, type: silhouetteFor(v.type, v.lengthM), heading: v.headingDeg, inZone: v.inZone, stale: false,
      scale: v.lengthM && v.lengthM > 200 ? 1.5 : v.lengthM && v.lengthM > 80 ? 1.2 : 0.85, source: v.source,
    },
    geometry: { type: 'Point', coordinates: v.lonlat },
  }));
  const contacts: F[] = s.contacts.map((c) => ({
    type: 'Feature', properties: { id: c.id, state: contactState(c), selected: c.id === selectedId },
    geometry: { type: 'Point', coordinates: c.lonlat },
  }));
  return {
    zones: fc(zoneFeatures(s.zones)),
    paths: fc(paths),
    routes: fc(routes),
    vessels: fc(vessels),
    contacts: fc(contacts),
    arrows: fc(arrowFeatures(s.zones)),
    you: EMPTY,
  };
}

export function captainChart(s: CaptainSnapshot | null, extrapolateMin: number): ChartData {
  if (!s) return { zones: EMPTY, paths: EMPTY, routes: EMPTY, vessels: EMPTY, contacts: EMPTY, arrows: EMPTY, you: EMPTY };
  const zones = s.notices.map((n) => {
    const shift = n.zone.movingTowardDeg !== null && extrapolateMin > 0 ? n.zone.movingSpeedMps * extrapolateMin * 60 : 0;
    const rings = shift > 0 && n.zone.movingTowardDeg !== null
      ? n.zone.rings.map((poly) => poly.map((ring) => ring.map((p) => offsetPoint(p, shift, n.zone.movingTowardDeg as number))))
      : n.zone.rings;
    const centerline = shift > 0 && n.zone.movingTowardDeg !== null ? n.zone.centerline.map((p) => offsetPoint(p, shift, n.zone.movingTowardDeg as number)) : n.zone.centerline;
    return { id: n.id, kind: n.zone.kind, status: 'published' as const, rings, centerline, movingTowardDeg: n.zone.movingTowardDeg, movingSpeedMps: n.zone.movingSpeedMps };
  });
  const you: F[] = [];
  const v = s.vessel;
  if (v) {
    if (v.newRoute) you.push({ type: 'Feature', properties: { kind: 'new' }, geometry: { type: 'LineString', coordinates: v.newRoute } });
    you.push({ type: 'Feature', properties: { heading: v.headingDeg }, geometry: { type: 'Point', coordinates: v.lonlat } });
  }
  const routes: F[] = v?.route ? [{ type: 'Feature', properties: { kind: 'planned' }, geometry: { type: 'LineString', coordinates: v.route } }] : [];
  const vessels: F[] = s.traffic.map((t, i) => ({
    type: 'Feature', properties: { id: `t${i}`, type: silhouetteFor(t.type, null), heading: t.headingDeg, inZone: false, stale: true, scale: 0.8 },
    geometry: { type: 'Point', coordinates: t.lonlat },
  }));
  return {
    zones: fc(zoneFeatures(zones)), paths: EMPTY, routes: fc(routes), vessels: fc(vessels), contacts: EMPTY,
    arrows: fc(arrowFeatures(zones)), you: fc(you),
  };
}
