import type { AreaView, CaptainSnapshot, CommandSnapshot, ContactView, ForecastTickView, ForecastView, ZoneView } from '../../shared/protocol';
import { offsetPoint, type LonLat } from '../../engine/geo';
import { silhouetteFor } from './chartImages';
import { EMPTY, type ChartData } from './ChartMap';

type F = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

const fc = (features: F[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

function zoneFeatures(zones: (Pick<ZoneView, 'id' | 'kind' | 'status' | 'rings'> & { area?: boolean })[]): F[] {
  return zones.filter((z) => z.rings.length).map((z) => ({
    type: 'Feature', properties: { id: z.id, kind: z.kind, status: z.status, area: !!z.area },
    geometry: { type: 'MultiPolygon', coordinates: z.rings },
  }));
}

function layerFeatures(owner: string, shapes: { likely: LonLat[][][]; careful: LonLat[][][] }): F[] {
  const out: F[] = [];
  if (shapes.careful.length) out.push({ type: 'Feature', properties: { owner, layer: 'careful' }, geometry: { type: 'MultiPolygon', coordinates: shapes.careful } });
  if (shapes.likely.length) out.push({ type: 'Feature', properties: { owner, layer: 'likely' }, geometry: { type: 'MultiPolygon', coordinates: shapes.likely } });
  return out;
}

function tickFeatures(owner: string, ticks: ForecastTickView[]): F[] {
  return ticks.map((t) => ({ type: 'Feature', properties: { id: `${owner}:${t.minutes}`, label: t.label }, geometry: { type: 'Point', coordinates: t.lonlat } }));
}

function areaOf(a: AreaView | null): { likely: LonLat[][][]; careful: LonLat[][][] } {
  return a ? { likely: a.likely, careful: a.careful } : { likely: [], careful: [] };
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

function contactSymbol(c: ContactView, state: string): string | null {
  if (c.registry.match && (state === 'friendly' || state === 'debris')) return 'symbol-robot';
  if (state === 'animal') return 'symbol-animal';
  if (c.classification.kind === 'powered' || c.classification.kind === 'unknown') return `drone-${c.risk ? c.risk.level.toLowerCase() : 'unknown'}`;
  return null;
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

const BLANK: ChartData = { zones: EMPTY, paths: EMPTY, routes: EMPTY, vessels: EMPTY, contacts: EMPTY, arrows: EMPTY, you: EMPTY, forecast: EMPTY, ticks: EMPTY, trails: EMPTY, sightings: EMPTY };

export function commandChart(s: CommandSnapshot | null, selectedId: string | null, forecasts: ForecastView[] = []): ChartData {
  if (!s) return BLANK;
  const live = new Set(s.contacts.map((c) => c.id));
  const forecast: F[] = [];
  const ticks: F[] = [];
  for (const f of forecasts) {
    if (!live.has(f.contactId)) continue;
    forecast.push(...layerFeatures(f.contactId, f));
    ticks.push(...tickFeatures(f.contactId, f.ticks));
  }
  const paths: F[] = [];
  for (const c of s.contacts) {
    if (c.track.length > 1) paths.push({ type: 'Feature', properties: { kind: 'track', rank: 9 }, geometry: { type: 'LineString', coordinates: c.track } });
  }
  const routes: F[] = [];
  const foreground = (v: CommandSnapshot['vessels'][number]) => !!v.affected || !!v.phone?.joined || v.id === selectedId;
  for (const v of s.vessels) {
    if (!v.affected && v.id !== selectedId) continue;
    if (v.route) routes.push({ type: 'Feature', properties: { kind: 'planned', id: v.id }, geometry: { type: 'LineString', coordinates: v.route } });
    if (v.newRoute) routes.push({ type: 'Feature', properties: { kind: 'new', id: v.id }, geometry: { type: 'LineString', coordinates: v.newRoute } });
  }
  const vessels: F[] = s.vessels.map((v) => ({
    type: 'Feature',
    properties: {
      id: v.id, type: silhouetteFor(v.type, v.lengthM), heading: v.headingDeg, inZone: !!v.affected && v.inZone, stale: false,
      scale: v.lengthM && v.lengthM > 200 ? 1.5 : v.lengthM && v.lengthM > 80 ? 1.2 : 0.85, source: v.source, bg: !foreground(v),
      flag: v.intel && v.intel.level !== 'normal' ? v.intel.level : 'none',
      ageSec: v.detail?.lastSeenSec ?? 0,
    },
    geometry: { type: 'Point', coordinates: v.lonlat },
  }));
  const contacts: F[] = s.contacts.map((c) => {
    const state = contactState(c);
    const props: Record<string, unknown> = { id: c.id, state, selected: c.id === selectedId, heading: c.headingDeg };
    const sym = contactSymbol(c, state);
    if (sym) props.symbol = sym;
    return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c.lonlat } };
  });
  return {
    zones: fc(zoneFeatures(s.zones.map((z) => ({ ...z, area: !!z.area })))),
    paths: fc(paths),
    routes: fc(routes),
    vessels: fc(vessels),
    contacts: fc(contacts),
    arrows: fc(arrowFeatures(s.zones.filter((z) => !z.area))),
    you: EMPTY,
    forecast: fc(forecast),
    ticks: fc(ticks),
    sightings: fc(s.sightings.filter((x) => x.dayOffset === 0).map((x) => ({ type: 'Feature', properties: { id: x.id, species: x.species, status: x.status }, geometry: { type: 'Point', coordinates: x.lonlat } }))),
    trails: fc(s.vessels.filter((v) => v.trail && v.trail.length > 1).map((v) => ({ type: 'Feature', properties: { id: v.id }, geometry: { type: 'LineString', coordinates: [...(v.trail as LonLat[]), v.lonlat] } }))),
  };
}

export interface CaptainChartExtras { youTag?: boolean; spot?: LonLat | null }

export const YOU_TAG_ID = 'you-tag';

export function captainChart(s: CaptainSnapshot | null, extrapolateMin: number, extras: CaptainChartExtras = {}): ChartData {
  if (!s) return BLANK;
  const forecast: F[] = [];
  const ticks: F[] = [];
  for (const n of s.notices) {
    if (!n.area) continue;
    forecast.push(...layerFeatures(n.id, areaOf(n.area)));
    ticks.push(...tickFeatures(n.id, n.area.ticks));
  }
  const zones = s.notices.filter((n) => !n.area).map((n) => {
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
    you.push({ type: 'Feature', properties: { id: 'you', heading: v.headingDeg }, geometry: { type: 'Point', coordinates: v.lonlat } });
  }
  const routes: F[] = v?.route ? [{ type: 'Feature', properties: { kind: 'planned' }, geometry: { type: 'LineString', coordinates: v.route } }] : [];
  const vessels: F[] = s.traffic.map((t) => ({
    type: 'Feature', properties: { id: t.id, type: silhouetteFor(t.type, null), heading: t.headingDeg, inZone: false, stale: true, scale: 0.8 },
    geometry: { type: 'Point', coordinates: t.lonlat },
  }));
  const contacts: F[] = v && extras.youTag ? [{ type: 'Feature', properties: { id: YOU_TAG_ID, state: 'you', selected: false }, geometry: { type: 'Point', coordinates: v.lonlat } }] : [];
  const paths: F[] = v && extras.spot ? [{ type: 'Feature', properties: { kind: 'track' }, geometry: { type: 'LineString', coordinates: [v.lonlat, extras.spot] } }] : [];
  return {
    zones: fc(zoneFeatures(zones)), paths: fc(paths), routes: fc(routes), vessels: fc(vessels), contacts: fc(contacts),
    arrows: fc(arrowFeatures(zones)), you: fc(you), forecast: fc(forecast), ticks: fc(ticks), trails: EMPTY, sightings: EMPTY,
  };
}
