import { contours } from 'd3-contour';
import gridJson from '../../data/harbor_grid.json';
import { loadGrid } from '../../engine/grid';
import { defaultSettings } from '../../engine/settings';
import type { LonLat } from '../../engine/geo';

const grid = loadGrid(gridJson as never);

export const NEAR_SHORE_METERS = 150;

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

function breakwaterCells(): Uint8Array {
  const mark = new Uint8Array(grid.nx * grid.ny);
  const lines = Object.values((gridJson as unknown as { breakwaters: Record<string, LonLat[]> }).breakwaters);
  const reach = 2.5;
  for (const line of lines) {
    const pts = line.map(([lon, lat]) => [(lon - grid.bbox.west) / grid.dlon, (grid.bbox.north - lat) / grid.dlat]);
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const X = Math.floor(x) + dx, Y = Math.floor(y) + dy;
          if (X < 0 || Y < 0 || X >= grid.nx || Y >= grid.ny) continue;
          if (Math.hypot(X + 0.5 - x, Y + 0.5 - y) <= reach) mark[Y * grid.nx + X] = 1;
        }
      }
    }
  }
  return mark;
}

function landDistanceCells(): Float32Array {
  const { nx, ny, water } = grid;
  const breakwater = breakwaterCells();
  const D = new Float32Array(nx * ny).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < nx * ny; i++) if (!water[i] && !breakwater[i]) { D[i] = 0; queue.push(i); }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % nx, y = (i / nx) | 0;
    for (const [dx, dy, c] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
      const j = Y * nx + X;
      if (D[i] + c < D[j]) { D[j] = D[i] + c; queue.push(j); }
    }
  }
  return D;
}

function gridToLonLat(gx: number, gy: number): LonLat {
  const { bbox, dlon, dlat } = grid;
  return [bbox.west + gx * dlon, bbox.north - gy * dlat];
}

export function nearShoreBand(): GeoJSON.FeatureCollection {
  const D = landDistanceCells();
  const limit = NEAR_SHORE_METERS / grid.cellMeters;
  const values = Array.from(D, (d) => (d === 0 ? -0.5 : Math.min(d - 0.25, limit - d)));
  const shape = contours().size([grid.nx, grid.ny]).thresholds([0])(values)[0];
  const coordinates = shape.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => gridToLonLat(x, y))));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } }] };
}

export function breakwaterLines(): GeoJSON.FeatureCollection {
  const features: Feature[] = Object.entries((gridJson as unknown as { breakwaters: Record<string, LonLat[]> }).breakwaters).map(([name, coords]) => ({
    type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates: coords },
  }));
  return { type: 'FeatureCollection', features };
}

export interface ChartLabel { id: string; text: string; lonlat: LonLat; kind: 'berth' | 'gate' | 'channel' | 'water' | 'breakwater' }

export function chartLabels(): ChartLabel[] {
  const h = defaultSettings.harbor;
  const out: ChartLabel[] = [
    ...h.targets.map((t) => ({ id: t.id, text: t.short ?? t.name, lonlat: [t.lon, t.lat] as LonLat, kind: 'berth' as const })),
    ...h.gates.map((g) => ({ id: g.name, text: g.name, lonlat: [g.lon, g.lat] as LonLat, kind: 'gate' as const })),
    ...h.places.map((p) => ({ id: p.id, text: p.name, lonlat: [p.lon, p.lat] as LonLat, kind: 'channel' as const })),
    { id: 'outer', text: 'Outer Harbor', lonlat: [-118.262, 33.716], kind: 'water' },
    { id: 'sanpedro', text: 'San Pedro Bay', lonlat: [-118.205, 33.705], kind: 'water' },
    { id: 'lbharbor', text: 'Long Beach Harbor', lonlat: [-118.205, 33.738], kind: 'water' },
  ];
  return out;
}

export const harborBounds = defaultSettings.map.bbox as [number, number, number, number];
export const harborCenter = defaultSettings.map.center as [number, number];
export const harborZoom = defaultSettings.map.zoom;
