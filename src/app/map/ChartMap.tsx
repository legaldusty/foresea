import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { chartColors, withAlpha, type ChartColors } from './chartTheme';
import { chartLabels, harborBounds, harborCenter, harborZoom, nearShoreBand } from './chartData';
import { loadChartImages, loadSymbolImages } from './chartImages';
import type { LonLat } from '../../engine/geo';

let protocolAdded = false;
function ensureProtocol(): void {
  if (protocolAdded) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocolAdded = true;
}

export type MapMode = 'select' | 'drive' | 'drop';

export interface ChartData {
  zones: GeoJSON.FeatureCollection;
  paths: GeoJSON.FeatureCollection;
  routes: GeoJSON.FeatureCollection;
  vessels: GeoJSON.FeatureCollection;
  contacts: GeoJSON.FeatureCollection;
  arrows: GeoJSON.FeatureCollection;
  you: GeoJSON.FeatureCollection;
  forecast: GeoJSON.FeatureCollection;
  ticks: GeoJSON.FeatureCollection;
}

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export type CalloutSide = 'ne' | 'se' | 'nw' | 'sw';

export interface ChartCallout { id: string; boat: string; when: string; action: string; lonlat: LonLat; side?: CalloutSide }

function calloutElement(): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'chart-callout';
  root.innerHTML = '<svg class="leader" width="40" height="40" viewBox="0 0 40 40"><line x1="0" y1="40" x2="40" y2="0" /></svg><div class="callout-box"><span class="boat"></span><span class="when"></span><span class="action"></span></div>';
  root.dataset.side = 'ne';
  return root;
}

export interface ChartMapProps {
  theme: 'night' | 'day';
  data: ChartData;
  mode?: MapMode;
  showLabels?: boolean;
  follow?: LonLat | null;
  fitTo?: LonLat[] | null;
  interactive?: boolean;
  onSelect?: (kind: 'vessel' | 'contact', id: string) => void;
  onPointer?: (lonlat: LonLat) => void;
  onDrop?: (lonlat: LonLat) => void;
  padding?: { top: number; right: number; bottom: number; left: number };
  compact?: boolean;
  recenter?: number;
  labels?: { id: string; text: string; lonlat: LonLat }[];
  callouts?: ChartCallout[];
  stamp?: number;
  motionDelayMs?: number;
  handles?: ZoneHandle[];
  onResize?: (id: string, radiusM: number) => void;
}

export interface ZoneHandle { id: string; center: LonLat; radiusM: number; label: string }

const EARTH_M_PER_DEG = 111_320;

function eastOf(center: LonLat, meters: number): LonLat {
  return [center[0] + meters / (EARTH_M_PER_DEG * Math.cos((center[1] * Math.PI) / 180)), center[1]];
}

function metersBetween(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * EARTH_M_PER_DEG * Math.cos((a[1] * Math.PI) / 180);
  const dy = (b[1] - a[1]) * EARTH_M_PER_DEG;
  return Math.hypot(dx, dy);
}

function ringAround(center: LonLat, meters: number): GeoJSON.FeatureCollection {
  const pts: LonLat[] = [];
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const dx = Math.cos(a) * meters;
    const dy = Math.sin(a) * meters;
    pts.push([center[0] + dx / (EARTH_M_PER_DEG * Math.cos((center[1] * Math.PI) / 180)), center[1] + dy / EARTH_M_PER_DEG]);
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] };
}

const DATA_SOURCES: (keyof ChartData)[] = ['zones', 'paths', 'routes', 'vessels', 'contacts', 'arrows', 'you', 'ticks'];
const FADE_MS = 400;
const FORECAST_OPACITY = { carefulFill: 0.22, carefulEdge: 1, likelyFill: 0.38, likelyEdge: 1 };
const FORECAST_SIDES = ['a', 'b'] as const;
type Side = (typeof FORECAST_SIDES)[number];

function forecastLayers(c: ChartColors, side: Side): maplibregl.LayerSpecification[] {
  const source = `forecast-${side}`;
  const fade = { duration: FADE_MS, delay: 0 };
  const layers = [
    { id: `fc-careful-fill-${side}`, type: 'fill', source, filter: ['==', ['get', 'layer'], 'careful'], paint: { 'fill-color': c.riskMedium, 'fill-opacity': 0, 'fill-opacity-transition': fade } },
    { id: `fc-careful-edge-${side}`, type: 'line', source, filter: ['==', ['get', 'layer'], 'careful'], layout: { 'line-join': 'round' }, paint: { 'line-color': c.riskMedium, 'line-width': 1.4, 'line-opacity': 0, 'line-opacity-transition': fade } },
    { id: `fc-likely-fill-${side}`, type: 'fill', source, filter: ['==', ['get', 'layer'], 'likely'], paint: { 'fill-color': c.riskHigh, 'fill-opacity': 0, 'fill-opacity-transition': fade } },
    { id: `fc-likely-edge-${side}`, type: 'line', source, filter: ['==', ['get', 'layer'], 'likely'], layout: { 'line-join': 'round' }, paint: { 'line-color': c.riskHigh, 'line-width': 1.6, 'line-opacity': 0, 'line-opacity-transition': fade } },
  ];
  return layers as unknown as maplibregl.LayerSpecification[];
}

function showForecast(map: MLMap, side: Side, on: boolean): void {
  map.setPaintProperty(`fc-careful-fill-${side}`, 'fill-opacity', on ? FORECAST_OPACITY.carefulFill : 0);
  map.setPaintProperty(`fc-careful-edge-${side}`, 'line-opacity', on ? FORECAST_OPACITY.carefulEdge : 0);
  map.setPaintProperty(`fc-likely-fill-${side}`, 'fill-opacity', on ? FORECAST_OPACITY.likelyFill : 0);
  map.setPaintProperty(`fc-likely-edge-${side}`, 'line-opacity', on ? FORECAST_OPACITY.likelyEdge : 0);
}
const MOTION_SOURCES: (keyof ChartData)[] = ['vessels', 'contacts', 'you'];
const STATIC_SOURCES: (keyof ChartData)[] = ['zones', 'paths', 'routes', 'arrows', 'ticks'];
const FRAMES_KEPT = 4;
const EXTRAPOLATE_MAX = 2;

interface MotionFrame { at: number; data: ChartData }

type PointFeature = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>;

function turn(a: number, b: number, f: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

const JUMP_DEGREES = 0.004;

function pointsById(fc: GeoJSON.FeatureCollection): Map<string, PointFeature> {
  const out = new Map<string, PointFeature>();
  for (const f of fc.features) {
    const id = (f.properties as Record<string, unknown> | null)?.id;
    if (f.geometry.type === 'Point' && id !== undefined) out.set(String(id), f as PointFeature);
  }
  return out;
}

function blend(older: GeoJSON.FeatureCollection, newer: GeoJSON.FeatureCollection, f: number): GeoJSON.FeatureCollection {
  const before = pointsById(older);
  const features = newer.features.map((feat) => {
    const id = (feat.properties as Record<string, unknown> | null)?.id;
    if (feat.geometry.type !== 'Point' || id === undefined) return feat;
    const prev = before.get(String(id));
    if (!prev) return feat;
    const [ax, ay] = prev.geometry.coordinates;
    const [bx, by] = (feat.geometry as GeoJSON.Point).coordinates;
    if (Math.abs(bx - ax) > JUMP_DEGREES || Math.abs(by - ay) > JUMP_DEGREES) return feat;
    const props = feat.properties as Record<string, unknown>;
    const ha = prev.properties.heading;
    const hb = props.heading;
    const heading = typeof ha === 'number' && typeof hb === 'number' ? turn(ha, hb, f) : hb;
    return { ...feat, properties: { ...props, heading }, geometry: { type: 'Point', coordinates: [ax + (bx - ax) * f, ay + (by - ay) * f] } } as GeoJSON.Feature;
  });
  return { type: 'FeatureCollection', features };
}

function clientNow(): number {
  return performance.timeOrigin + performance.now();
}

function buildStyle(c: ChartColors, theme: 'night' | 'day'): StyleSpecification {
  const night = theme === 'night';
  return {
    version: 8,
    sources: {
      chart: { type: 'vector', url: `pmtiles://${location.origin}/tiles/harbor.pmtiles`, attribution: 'OpenStreetMap contributors' },
      nearshore: { type: 'geojson', data: nearShoreBand() },
      ...Object.fromEntries(DATA_SOURCES.map((k) => [k, { type: 'geojson', data: EMPTY }])),
      'forecast-a': { type: 'geojson', data: EMPTY },
      'forecast-b': { type: 'geojson', data: EMPTY },
      'resize-preview': { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.water } },
      { id: 'water', type: 'fill', source: 'chart', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'nearshore', type: 'fill', source: 'nearshore', paint: { 'fill-color': c.shallows, 'fill-antialias': true } },
      { id: 'earth', type: 'fill', source: 'chart', 'source-layer': 'earth', filter: ['in', ['get', 'kind'], ['literal', ['earth', 'island']]], paint: { 'fill-color': c.land } },
      { id: 'landuse-pier', type: 'fill', source: 'chart', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['pier', 'platform']]], paint: { 'fill-color': c.land } },
      { id: 'buildings', type: 'fill', source: 'chart', 'source-layer': 'buildings', minzoom: 13, paint: { 'fill-color': c.landEdge, 'fill-opacity': night ? 0.35 : 0.45 } },
      { id: 'roads', type: 'line', source: 'chart', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]], paint: { 'line-color': c.landEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 15, 1.2], 'line-opacity': night ? 0.55 : 0.7 } },
      { id: 'coast', type: 'line', source: 'chart', 'source-layer': 'earth', paint: { 'line-color': c.landEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1.4] } },
      { id: 'pier-edge', type: 'line', source: 'chart', 'source-layer': 'landuse', filter: ['==', ['get', 'kind'], 'pier'], paint: { 'line-color': c.landEdge, 'line-width': 0.8 } },
      ...forecastLayers(c, 'a'),
      ...forecastLayers(c, 'b'),
      { id: 'zone-fill-slow', type: 'fill', source: 'zones', filter: ['all', ['==', ['get', 'kind'], 'slow'], ['!', ['get', 'area']]], paint: { 'fill-pattern': 'hatch-slow', 'fill-opacity': ['case', ['==', ['get', 'status'], 'draft'], 0.55, 1] } },
      { id: 'zone-fill-keepout', type: 'fill', source: 'zones', filter: ['all', ['==', ['get', 'kind'], 'keepOut'], ['!', ['get', 'area']]], paint: { 'fill-pattern': 'hatch-keepout', 'fill-opacity': ['case', ['==', ['get', 'status'], 'draft'], 0.55, 1] } },
      { id: 'zone-edge', type: 'line', source: 'zones', filter: ['==', ['get', 'status'], 'published'], paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'slow'], c.riskMedium, c.riskHigh], 'line-width': 1.6 } },
      { id: 'resize-preview', type: 'line', source: 'resize-preview', paint: { 'line-color': c.tide, 'line-width': 2, 'line-dasharray': [2, 1.5] } },
      { id: 'zone-edge-draft', type: 'line', source: 'zones', filter: ['==', ['get', 'status'], 'draft'], paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'slow'], c.riskMedium, c.riskHigh], 'line-width': 1.4, 'line-dasharray': [3, 2] } },
      { id: 'route-old', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'planned'], paint: { 'line-color': withAlpha(c.muted, night ? 0.55 : 0.6), 'line-width': 1.2, 'line-dasharray': [2, 2] } },
      { id: 'route-new', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'new'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.tide, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 4] } },
      { id: 'track', type: 'line', source: 'paths', filter: ['==', ['get', 'kind'], 'track'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': c.text, 'line-width': 1, 'line-opacity': 0.7 } },
      { id: 'tick-rings', type: 'circle', source: 'ticks', paint: { 'circle-radius': 4, 'circle-color': c.bg, 'circle-stroke-width': 1.5, 'circle-stroke-color': c.text } },
      { id: 'arrows-line', type: 'line', source: 'arrows', paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'slow'], c.riskMedium, c.riskHigh], 'line-width': 1.4, 'line-dasharray': [2, 1.6] } },
      { id: 'arrows-head', type: 'symbol', source: 'arrows', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': ['case', ['==', ['get', 'kind'], 'slow'], 'arrow-slow', 'arrow-keepout'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': 0.5 } },
      { id: 'vessels', type: 'symbol', source: 'vessels', layout: {
        'icon-image': ['coalesce', ['image', ['concat', 'v-', ['get', 'type']]], ['image', 'v-other']],
        'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, ['*', 0.55, ['get', 'scale'], ['case', ['==', ['get', 'bg'], true], 0.75, 1]], 13, ['*', 0.8, ['get', 'scale'], ['case', ['==', ['get', 'bg'], true], 0.75, 1]], 15, ['*', 1.25, ['get', 'scale'], ['case', ['==', ['get', 'bg'], true], 0.75, 1]]],
        'symbol-sort-key': ['case', ['==', ['get', 'bg'], true], 0, 1],
      }, paint: { 'icon-opacity': ['case', ['==', ['get', 'bg'], true], 0.4, ['==', ['get', 'stale'], true], 0.5, 1] } },
      { id: 'vessels-alert', type: 'symbol', source: 'vessels', filter: ['get', 'inZone'], layout: { 'icon-image': 'ring-alert', 'icon-allow-overlap': true, 'icon-size': 0.6 } },
      { id: 'contacts-ring', type: 'symbol', source: 'contacts', filter: ['==', ['get', 'selected'], true], layout: { 'icon-image': 'symbol-ring', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1 } },
      { id: 'contacts', type: 'symbol', source: 'contacts', layout: {
        'icon-image': ['coalesce', ['image', ['get', 'symbol']], ['image', ['concat', 'diamond-', ['get', 'state']]]],
        'icon-rotate': ['coalesce', ['get', 'heading'], 0], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['case', ['has', 'symbol'], 1, ['==', ['get', 'selected'], true], 0.75, 0.6],
      } },
      { id: 'you-route', type: 'line', source: 'you', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.tide, 'line-width': 4 } },
      { id: 'you', type: 'symbol', source: 'you', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': 'you', 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': 0.6 } },
    ],
  };
}

export function ChartMap(props: ChartMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const labelsRef = useRef<maplibregl.Marker[]>([]);
  const dynLabels = useRef(new Map<string, maplibregl.Marker>());
  const lastPointer = useRef(0);
  const steering = useRef(false);
  const frames = useRef<MotionFrame[]>([]);
  const clockOffset = useRef<number | null>(null);
  const staticKeys = useRef(new Map<keyof ChartData, string>());
  const forecastFront = useRef<Side>('a');
  const forecastKey = useRef('');
  const tickLabels = useRef(new Map<string, maplibregl.Marker>());
  const calloutMarkers = useRef(new Map<string, maplibregl.Marker>());
  const motionStats = useRef<{ frames: number; lastMs: number; contact: number[] | null }>({ frames: 0, lastMs: 0, contact: null });
  const handleMarkers = useRef(new Map<string, maplibregl.Marker>());
  const dragging = useRef<string | null>(null);

  useEffect(() => {
    ensureProtocol();
    const el = holder.current as HTMLDivElement;
    const colors = chartColors(props.theme, el);
    const map = new maplibregl.Map({
      container: el,
      style: buildStyle(colors, props.theme),
      center: harborCenter,
      zoom: props.compact ? harborZoom - 0.6 : harborZoom,
      minZoom: 11,
      maxZoom: 16.5,
      maxBounds: [[harborBounds[0] - 0.08, harborBounds[1] - 0.06], [harborBounds[2] + 0.08, harborBounds[3] + 0.06]],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      interactive: props.interactive !== false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    if (!props.compact) (window as unknown as { givewayChart?: MLMap }).givewayChart = map;
    map.on('load', async () => {
      if (!props.compact) map.fitBounds([[-118.292, 33.700], [-118.150, 33.768]], { padding: 24, duration: 0 });
      try {
        await loadChartImages(map, colors, el);
        await loadSymbolImages(map, colors, el);
      } catch {
        return;
      }
      if (mapRef.current !== map) return;
      readyRef.current = true;
      staticKeys.current.clear();
      forecastKey.current = '';
      pushStatic(map, propsRef.current.data, staticKeys.current);
      pushForecast(map, propsRef.current.data);
      pushMotion(map, propsRef.current.data);
      addLabels();
    });
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!readyRef.current) return;
      const list = frames.current;
      if (!list.length) return;
      const delay = propsRef.current.motionDelayMs ?? 300;
      const renderAt = clientNow() - delay;
      let older = list[0];
      let newer = list[list.length - 1];
      for (let k = 0; k < list.length - 1; k++) {
        if (list[k].at <= renderAt && list[k + 1].at >= renderAt) { older = list[k]; newer = list[k + 1]; break; }
      }
      if (renderAt >= list[list.length - 1].at && list.length > 1) { older = list[list.length - 2]; newer = list[list.length - 1]; }
      const span = newer.at - older.at;
      const f = span > 0 ? Math.max(0, Math.min(EXTRAPOLATE_MAX, (renderAt - older.at) / span)) : 1;
      const t0 = performance.now();
      for (const key of MOTION_SOURCES) {
        const src = map.getSource(key) as GeoJSONSource | undefined;
        const shown = older === newer ? newer.data[key] : blend(older.data[key], newer.data[key], f);
        src?.setData(shown);
        if (key === 'contacts') { const first = shown.features[0]; motionStats.current.contact = first && first.geometry.type === 'Point' ? first.geometry.coordinates : null; }
        if ((dynLabels.current.size || calloutMarkers.current.size) && key !== 'you') {
          for (const feat of shown.features) {
            const id = (feat.properties as Record<string, unknown> | null)?.id;
            if (id === undefined || feat.geometry.type !== 'Point') continue;
            const at = feat.geometry.coordinates as [number, number];
            dynLabels.current.get(String(id))?.setLngLat(at);
            const callout = calloutMarkers.current.get(String(id));
            if (callout) {
              callout.setLngLat(at);
              const el = callout.getElement();
              const want = el.dataset.want ?? el.dataset.side ?? 'ne';
              const px = map.project(at);
              const width = map.getContainer().clientWidth;
              const vertical = want.charAt(0);
              const side = px.x > width - 340 ? `${vertical}w` : px.x < 340 ? `${vertical}e` : want;
              if (el.dataset.side !== side) el.dataset.side = side;
            }
          }
        }
      }
      motionStats.current.frames++;
      motionStats.current.lastMs = performance.now() - t0;
    };
    raf = requestAnimationFrame(loop);
    if (!props.compact) (window as unknown as { givewayMotion?: typeof motionStats.current }).givewayMotion = motionStats.current;
    map.on('styleimagemissing', () => undefined);
    map.on('click', (e) => {
      const p = propsRef.current;
      if (p.mode === 'drop') { p.onDrop?.([e.lngLat.lng, e.lngLat.lat]); return; }
      if (p.mode === 'drive') { p.onPointer?.([e.lngLat.lng, e.lngLat.lat]); return; }
      const hits = map.queryRenderedFeatures(e.point, { layers: ['contacts', 'vessels'].filter((l) => map.getLayer(l)) });
      const hit = hits[0];
      if (hit) p.onSelect?.(hit.layer.id === 'contacts' ? 'contact' : 'vessel', String(hit.properties?.id));
    });
    const steer = (lng: number, lat: number, force = false) => {
      const p = propsRef.current;
      if (p.mode !== 'drive') return;
      const now = performance.now();
      if (!force && now - lastPointer.current < 80) return;
      lastPointer.current = now;
      p.onPointer?.([lng, lat]);
    };
    map.on('mousedown', (e) => { if (propsRef.current.mode === 'drive') { steering.current = true; steer(e.lngLat.lng, e.lngLat.lat, true); } });
    map.on('mousemove', (e) => { if (steering.current) steer(e.lngLat.lng, e.lngLat.lat); });
    map.on('mouseup', () => { steering.current = false; });
    map.on('touchstart', (e) => { if (propsRef.current.mode === 'drive') { steering.current = true; steer(e.lngLat.lng, e.lngLat.lat, true); } });
    map.on('touchmove', (e) => { if (steering.current) steer(e.lngLat.lng, e.lngLat.lat); });
    map.on('touchend', () => { steering.current = false; });
    function addLabels() {
      for (const m of labelsRef.current) m.remove();
      labelsRef.current = [];
      if (propsRef.current.showLabels === false) return;
      for (const l of chartLabels()) {
        const div = document.createElement('div');
        div.className = `chart-label chart-label-${l.kind}`;
        div.textContent = l.text;
        labelsRef.current.push(new maplibregl.Marker({ element: div, anchor: l.kind === 'berth' ? 'left' : 'center', offset: l.kind === 'berth' ? [8, 0] : [0, 0] }).setLngLat(l.lonlat).addTo(map));
      }
    }
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); for (const m of tickLabels.current.values()) m.remove(); tickLabels.current.clear(); for (const m of handleMarkers.current.values()) m.remove(); handleMarkers.current.clear(); for (const m of calloutMarkers.current.values()) m.remove(); calloutMarkers.current.clear(); for (const m of labelsRef.current) m.remove(); for (const m of dynLabels.current.values()) m.remove(); dynLabels.current.clear(); map.remove(); mapRef.current = null; readyRef.current = false; };
  }, [props.theme]);

  useEffect(() => {
    const now = clientNow();
    const stamp = props.stamp ?? now;
    const offset = now - stamp;
    clockOffset.current = clockOffset.current === null ? offset : Math.min(offset, clockOffset.current + 2);
    const at = stamp + clockOffset.current;
    const list = frames.current;
    if (list.length && at <= list[list.length - 1].at) list[list.length - 1] = { at: list[list.length - 1].at, data: props.data };
    else list.push({ at, data: props.data });
    while (list.length > FRAMES_KEPT) list.shift();
    const map = mapRef.current;
    if (map && readyRef.current) { pushStatic(map, props.data, staticKeys.current); pushForecast(map, props.data); }
  }, [props.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Map((props.labels ?? []).map((l) => [l.id, l]));
    for (const [id, m] of dynLabels.current) if (!want.has(id)) { m.remove(); dynLabels.current.delete(id); }
    for (const l of want.values()) {
      let m = dynLabels.current.get(l.id);
      if (!m) {
        const div = document.createElement('div');
        div.className = 'chart-label chart-label-contact';
        m = new maplibregl.Marker({ element: div, anchor: 'left', offset: [14, 0] }).setLngLat(l.lonlat).addTo(map);
        dynLabels.current.set(l.id, m);
      }
      (m.getElement() as HTMLElement).textContent = l.text;
    }
  }, [props.labels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Map((props.callouts ?? []).map((c) => [c.id, c]));
    for (const [id, m] of calloutMarkers.current) if (!want.has(id)) { m.remove(); calloutMarkers.current.delete(id); }
    for (const c of want.values()) {
      let m = calloutMarkers.current.get(c.id);
      if (!m) {
        m = new maplibregl.Marker({ element: calloutElement(), anchor: 'bottom-left' }).setLngLat(c.lonlat).addTo(map);
        calloutMarkers.current.set(c.id, m);
      }
      const el = m.getElement();
      el.dataset.want = c.side ?? 'ne';
      el.dataset.side = c.side ?? 'ne';
      (el.querySelector('.boat') as HTMLElement).textContent = c.boat;
      (el.querySelector('.when') as HTMLElement).textContent = c.when;
      (el.querySelector('.action') as HTMLElement).textContent = c.action;
    }
  }, [JSON.stringify((props.callouts ?? []).map((c) => [c.id, c.boat, c.when, c.action, c.side]))]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.mode === 'drive' || props.mode === 'drop' ? 'crosshair' : '';
    if (props.mode === 'drive') { map.dragPan.disable(); map.touchZoomRotate.disable(); } else if (props.interactive !== false) { map.dragPan.enable(); map.touchZoomRotate.enable(); map.touchZoomRotate.disableRotation(); }
  }, [props.mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.follow) return;
    map.easeTo({ center: props.follow, duration: 600 });
  }, [props.follow?.[0], props.follow?.[1]]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.follow || !props.recenter) return;
    map.easeTo({ center: props.follow, zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [props.recenter]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.fitTo || props.fitTo.length < 2) return;
    const b = new maplibregl.LngLatBounds(props.fitTo[0], props.fitTo[0]);
    for (const p of props.fitTo) b.extend(p);
    map.fitBounds(b, { padding: props.padding ?? 60, maxZoom: 15, duration: 700 });
  }, [JSON.stringify(props.fitTo)]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Map((props.handles ?? []).map((h) => [h.id, h]));
    for (const [id, m] of handleMarkers.current) if (!want.has(id)) { m.remove(); handleMarkers.current.delete(id); }
    for (const h of want.values()) {
      if (dragging.current === h.id) continue;
      let m = handleMarkers.current.get(h.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'zone-handle';
        el.dataset.testid = `zone-handle-${h.id}`;
        el.innerHTML = '<i></i><span></span>';
        m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' });
        const marker = m;
        marker.on('dragstart', () => { dragging.current = h.id; el.classList.add('active'); });
        marker.on('drag', () => {
          const cur = (propsRef.current.handles ?? []).find((x) => x.id === h.id) ?? h;
          const at = marker.getLngLat();
          const r = Math.max(50, Math.min(3000, Math.round(metersBetween(cur.center, [at.lng, at.lat]) / 10) * 10));
          (el.querySelector('span') as HTMLElement).textContent = `${r} m`;
          (map.getSource('resize-preview') as GeoJSONSource | undefined)?.setData(ringAround(cur.center, r));
        });
        marker.on('dragend', () => {
          const cur = (propsRef.current.handles ?? []).find((x) => x.id === h.id) ?? h;
          const at = marker.getLngLat();
          const r = Math.max(50, Math.min(3000, Math.round(metersBetween(cur.center, [at.lng, at.lat]) / 10) * 10));
          dragging.current = null;
          el.classList.remove('active');
          marker.setLngLat(eastOf(cur.center, r));
          (map.getSource('resize-preview') as GeoJSONSource | undefined)?.setData(EMPTY);
          propsRef.current.onResize?.(cur.id, r);
        });
        m.setLngLat(eastOf(h.center, h.radiusM)).addTo(map);
        handleMarkers.current.set(h.id, m);
      }
      m.setLngLat(eastOf(h.center, h.radiusM));
      const el = m.getElement();
      el.title = `${h.label}. Drag to resize.`;
      (el.querySelector('span') as HTMLElement).textContent = `${h.radiusM} m`;
    }
  }, [JSON.stringify(props.handles ?? [])]);

  function pushForecast(map: MLMap, data: ChartData): void {
    const key = JSON.stringify(data.forecast);
    if (key !== forecastKey.current) {
      forecastKey.current = key;
      const back: Side = forecastFront.current === 'a' ? 'b' : 'a';
      (map.getSource(`forecast-${back}`) as GeoJSONSource | undefined)?.setData(data.forecast);
      showForecast(map, back, true);
      showForecast(map, forecastFront.current, false);
      forecastFront.current = back;
    }
    const want = new Map<string, { label: string; lonlat: [number, number] }>();
    for (const f of data.ticks.features) {
      const props = f.properties as Record<string, unknown> | null;
      if (f.geometry.type !== 'Point' || !props) continue;
      want.set(String(props.id), { label: String(props.label), lonlat: f.geometry.coordinates as [number, number] });
    }
    for (const [id, m] of tickLabels.current) if (!want.has(id)) { m.remove(); tickLabels.current.delete(id); }
    for (const [id, t] of want) {
      let m = tickLabels.current.get(id);
      if (!m) {
        const div = document.createElement('div');
        div.className = 'chart-label chart-label-time';
        m = new maplibregl.Marker({ element: div, anchor: 'left', offset: [8, 0] }).setLngLat(t.lonlat).addTo(map);
        tickLabels.current.set(id, m);
      }
      (m.getElement() as HTMLElement).textContent = t.label;
      m.setLngLat(t.lonlat);
    }
  }

  return <div className="chart-wrap" data-theme={props.theme}><div ref={holder} className="chart-map" /></div>;
}

function pushStatic(map: MLMap, data: ChartData, keys: Map<keyof ChartData, string>): void {
  for (const key of STATIC_SOURCES) {
    const text = JSON.stringify(data[key]);
    if (keys.get(key) === text) continue;
    keys.set(key, text);
    const src = map.getSource(key) as GeoJSONSource | undefined;
    src?.setData(data[key]);
  }
}

function pushMotion(map: MLMap, data: ChartData): void {
  for (const key of MOTION_SOURCES) {
    const src = map.getSource(key) as GeoJSONSource | undefined;
    src?.setData(data[key]);
  }
}
