import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { chartColors, withAlpha, type ChartColors } from './chartTheme';
import { chartLabels, harborBounds, harborCenter, harborZoom, nearShoreBand } from './chartData';
import { loadChartImages } from './chartImages';
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
}

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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
}

const DATA_SOURCES: (keyof ChartData)[] = ['zones', 'paths', 'routes', 'vessels', 'contacts', 'arrows', 'you'];

function buildStyle(c: ChartColors, theme: 'night' | 'day'): StyleSpecification {
  const night = theme === 'night';
  return {
    version: 8,
    sources: {
      chart: { type: 'vector', url: `pmtiles://${location.origin}/tiles/harbor.pmtiles`, attribution: 'OpenStreetMap contributors' },
      nearshore: { type: 'geojson', data: nearShoreBand() },
      ...Object.fromEntries(DATA_SOURCES.map((k) => [k, { type: 'geojson', data: EMPTY }])),
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
      { id: 'zone-fill-slow', type: 'fill', source: 'zones', filter: ['==', ['get', 'kind'], 'slow'], paint: { 'fill-pattern': 'hatch-slow', 'fill-opacity': ['case', ['==', ['get', 'status'], 'draft'], 0.55, 1] } },
      { id: 'zone-fill-keepout', type: 'fill', source: 'zones', filter: ['==', ['get', 'kind'], 'keepOut'], paint: { 'fill-pattern': 'hatch-keepout', 'fill-opacity': ['case', ['==', ['get', 'status'], 'draft'], 0.55, 1] } },
      { id: 'zone-edge', type: 'line', source: 'zones', filter: ['==', ['get', 'status'], 'published'], paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'slow'], c.riskMedium, c.riskHigh], 'line-width': 1.6 } },
      { id: 'zone-edge-draft', type: 'line', source: 'zones', filter: ['==', ['get', 'status'], 'draft'], paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'slow'], c.riskMedium, c.riskHigh], 'line-width': 1.4, 'line-dasharray': [3, 2] } },
      { id: 'route-old', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'planned'], paint: { 'line-color': withAlpha(c.muted, night ? 0.55 : 0.6), 'line-width': 1.2, 'line-dasharray': [2, 2] } },
      { id: 'route-new', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'new'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.tide, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 4] } },
      { id: 'path-predicted', type: 'line', source: 'paths', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'rank'], 0], c.text, c.muted], 'line-width': ['case', ['==', ['get', 'rank'], 0], 1.6, 1.1], 'line-dasharray': [3, 2.5], 'line-opacity': ['case', ['==', ['get', 'rank'], 0], 0.9, 0.6] } },
      { id: 'track', type: 'line', source: 'paths', filter: ['==', ['get', 'kind'], 'track'], paint: { 'line-color': c.muted, 'line-width': 1, 'line-opacity': 0.6 } },
      { id: 'arrows-line', type: 'line', source: 'arrows', paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'slow'], c.riskMedium, c.riskHigh], 'line-width': 1.4, 'line-dasharray': [2, 1.6] } },
      { id: 'arrows-head', type: 'symbol', source: 'arrows', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': ['case', ['==', ['get', 'kind'], 'slow'], 'arrow-slow', 'arrow-keepout'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': 0.5 } },
      { id: 'path-heads', type: 'symbol', source: 'paths', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': 'arrow-path', 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': 0.45 } },
      { id: 'vessels', type: 'symbol', source: 'vessels', layout: {
        'icon-image': ['coalesce', ['image', ['concat', 'v-', ['get', 'type']]], ['image', 'v-other']],
        'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, ['*', 0.55, ['get', 'scale']], 13, ['*', 0.8, ['get', 'scale']], 15, ['*', 1.25, ['get', 'scale']]],
      }, paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.5, 1] } },
      { id: 'vessels-alert', type: 'symbol', source: 'vessels', filter: ['get', 'inZone'], layout: { 'icon-image': 'ring-alert', 'icon-allow-overlap': true, 'icon-size': 0.6 } },
      { id: 'contacts', type: 'symbol', source: 'contacts', layout: { 'icon-image': ['concat', 'diamond-', ['get', 'state']], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['case', ['get', 'selected'], 0.75, 0.6] } },
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
  const lastPointer = useRef(0);

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
      await loadChartImages(map, colors, el);
      readyRef.current = true;
      pushData(map, propsRef.current.data);
      addLabels();
    });
    map.on('styleimagemissing', () => undefined);
    map.on('click', (e) => {
      const p = propsRef.current;
      if (p.mode === 'drop') { p.onDrop?.([e.lngLat.lng, e.lngLat.lat]); return; }
      if (p.mode === 'drive') { p.onPointer?.([e.lngLat.lng, e.lngLat.lat]); return; }
      const hits = map.queryRenderedFeatures(e.point, { layers: ['contacts', 'vessels'].filter((l) => map.getLayer(l)) });
      const hit = hits[0];
      if (hit) p.onSelect?.(hit.layer.id === 'contacts' ? 'contact' : 'vessel', String(hit.properties?.id));
    });
    map.on('mousemove', (e) => {
      const p = propsRef.current;
      if (p.mode !== 'drive') return;
      const now = performance.now();
      if (now - lastPointer.current < 80) return;
      lastPointer.current = now;
      p.onPointer?.([e.lngLat.lng, e.lngLat.lat]);
    });
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
    return () => { ro.disconnect(); for (const m of labelsRef.current) m.remove(); map.remove(); mapRef.current = null; readyRef.current = false; };
  }, [props.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) pushData(map, props.data);
  }, [props.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.mode === 'drive' || props.mode === 'drop' ? 'crosshair' : '';
  }, [props.mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.follow) return;
    map.easeTo({ center: props.follow, duration: 600 });
  }, [props.follow?.[0], props.follow?.[1]]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.fitTo || props.fitTo.length < 2) return;
    const b = new maplibregl.LngLatBounds(props.fitTo[0], props.fitTo[0]);
    for (const p of props.fitTo) b.extend(p);
    map.fitBounds(b, { padding: props.padding ?? 60, maxZoom: 15, duration: 700 });
  }, [JSON.stringify(props.fitTo)]);

  return <div className="chart-wrap" data-theme={props.theme}><div ref={holder} className="chart-map" /></div>;
}

function pushData(map: MLMap, data: ChartData): void {
  for (const key of DATA_SOURCES) {
    const src = map.getSource(key) as GeoJSONSource | undefined;
    src?.setData(data[key]);
  }
}
