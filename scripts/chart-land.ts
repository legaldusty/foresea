import fs from 'node:fs';
import zlib from 'node:zlib';
import { Compression, PMTiles, type Source } from 'pmtiles';
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { BBox } from '../src/engine/grid';

export interface ChartLandLayer {
  sourceLayer: string;
  kinds: readonly string[];
}

export const CHART_LAND_LAYERS: readonly ChartLandLayer[] = [
  { sourceLayer: 'earth', kinds: ['earth', 'island'] },
  { sourceLayer: 'landuse', kinds: ['pier', 'platform'] },
];

const POLYGON_FEATURE = 3;
const METERS_PER_DEGREE_LAT = 111_320;
const OUTLINE_STEPS_PER_SAMPLE = 4;

export type RasterPoint = [number, number];

export interface GridFrame {
  bbox: BBox;
  cellMeters: number;
  nx: number;
  ny: number;
  dlon: number;
  dlat: number;
}

export interface LandRaster {
  frame: GridFrame;
  zoom: number;
  samplesPerCell: number;
  width: number;
  height: number;
  inside: Uint8Array;
  touched: Uint8Array;
}

export interface RasterStats {
  tilesRead: number;
  tilesMissing: number;
  polygons: Record<string, number>;
}

export function gridFrame(bbox: BBox, cellMeters: number): GridFrame {
  const midLat = (bbox.south + bbox.north) / 2;
  const dlat = cellMeters / METERS_PER_DEGREE_LAT;
  const dlon = cellMeters / (METERS_PER_DEGREE_LAT * Math.cos((midLat * Math.PI) / 180));
  return {
    bbox, cellMeters, dlon, dlat,
    nx: Math.round((bbox.east - bbox.west) / dlon),
    ny: Math.round((bbox.north - bbox.south) / dlat),
  };
}

export function chartFillSnippet(layer: ChartLandLayer): string {
  const kinds = layer.kinds.map((k) => `'${k}'`).join(', ');
  return `'source-layer': '${layer.sourceLayer}', filter: ['in', ['get', 'kind'], ['literal', [${kinds}]]], paint: { 'fill-color': c.land } }`;
}

export function layersMissingFromChart(chartMapSource: string): ChartLandLayer[] {
  return CHART_LAND_LAYERS.filter((layer) => !chartMapSource.includes(chartFillSnippet(layer)));
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fileSource(file: string): Source {
  const fd = fs.openSync(file, 'r');
  return {
    getKey: () => file,
    getBytes: async (offset, length) => {
      const bytes = Buffer.alloc(length);
      fs.readSync(fd, bytes, 0, length, offset);
      return { data: arrayBufferOf(bytes) };
    },
  };
}

async function decompress(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) return buf;
  if (compression === Compression.Gzip) return arrayBufferOf(zlib.gunzipSync(new Uint8Array(buf)));
  if (compression === Compression.Brotli) return arrayBufferOf(zlib.brotliDecompressSync(new Uint8Array(buf)));
  throw new Error(`Tile compression ${compression} is not supported`);
}

export function openChartTiles(file: string): PMTiles {
  return new PMTiles(fileSource(file), undefined, decompress);
}

function tileColumn(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function tileRow(lat: number, zoom: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** zoom);
}

function tileProjector(r: LandRaster, tileX: number, tileY: number, extent: number): (x: number, y: number) => RasterPoint {
  const n = 2 ** r.zoom;
  const { bbox, dlon, dlat } = r.frame;
  const s = r.samplesPerCell;
  return (x, y) => {
    const lon = ((tileX + x / extent) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + y / extent)) / n))) * 180) / Math.PI;
    return [((lon - bbox.west) / dlon) * s, ((bbox.north - lat) / dlat) * s];
  };
}

function fillPolygon(r: LandRaster, rings: RasterPoint[][]): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const firstRow = Math.max(0, Math.ceil(minY - 0.5));
  const lastRow = Math.min(r.height - 1, Math.floor(maxY - 0.5));
  if (firstRow > lastRow) return;
  const crossings: number[][] = Array.from({ length: lastRow - firstRow + 1 }, () => []);
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const [ax, ay] = ring[k];
      const [bx, by] = ring[(k + 1) % ring.length];
      if (ay === by) continue;
      const top = Math.min(ay, by);
      const bottom = Math.max(ay, by);
      const fromRow = Math.max(firstRow, Math.ceil(top - 0.5));
      const toRow = Math.min(lastRow, Math.ceil(bottom - 0.5) - 1);
      for (let j = fromRow; j <= toRow; j++) crossings[j - firstRow].push(ax + ((j + 0.5 - ay) * (bx - ax)) / (by - ay));
    }
  }
  crossings.forEach((xs, row) => {
    xs.sort((a, b) => a - b);
    const offset = (firstRow + row) * r.width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(r.width - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let i = from; i <= to; i++) r.inside[offset + i] = 1;
    }
  });
}

function traceOutline(r: LandRaster, rings: RasterPoint[][]): void {
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const [ax, ay] = ring[k];
      const [bx, by] = ring[(k + 1) % ring.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * OUTLINE_STEPS_PER_SAMPLE));
      for (let s = 0; s <= steps; s++) {
        const x = Math.floor(ax + ((bx - ax) * s) / steps);
        const y = Math.floor(ay + ((by - ay) * s) / steps);
        if (x >= 0 && y >= 0 && x < r.width && y < r.height) r.touched[y * r.width + x] = 1;
      }
    }
  }
}

export async function rasterizeChartLand(
  tiles: PMTiles, frame: GridFrame, zoom: number, samplesPerCell: number, layers: readonly ChartLandLayer[] = CHART_LAND_LAYERS,
): Promise<{ raster: LandRaster; stats: RasterStats }> {
  if (samplesPerCell % 2 !== 1) throw new Error('samplesPerCell must be odd so a sample sits on every cell center');
  const width = frame.nx * samplesPerCell;
  const height = frame.ny * samplesPerCell;
  const raster: LandRaster = {
    frame, zoom, samplesPerCell, width, height,
    inside: new Uint8Array(width * height),
    touched: new Uint8Array(width * height),
  };
  const east = frame.bbox.west + frame.nx * frame.dlon;
  const south = frame.bbox.north - frame.ny * frame.dlat;
  const stats: RasterStats = { tilesRead: 0, tilesMissing: 0, polygons: {} };
  for (let tx = tileColumn(frame.bbox.west, zoom); tx <= tileColumn(east, zoom); tx++) {
    for (let ty = tileRow(frame.bbox.north, zoom); ty <= tileRow(south, zoom); ty++) {
      const tile = await tiles.getZxy(zoom, tx, ty);
      if (!tile) { stats.tilesMissing++; continue; }
      stats.tilesRead++;
      const vt = new VectorTile(new Pbf(new Uint8Array(tile.data)));
      for (const layer of layers) {
        const source = vt.layers[layer.sourceLayer];
        if (!source) continue;
        const project = tileProjector(raster, tx, ty, source.extent);
        for (let f = 0; f < source.length; f++) {
          const feature = source.feature(f);
          const kind = String(feature.properties.kind);
          if (feature.type !== POLYGON_FEATURE || !layer.kinds.includes(kind)) continue;
          const key = `${layer.sourceLayer} ${kind}`;
          for (const polygon of classifyRings(feature.loadGeometry())) {
            const rings = polygon.map((ring) => ring.map((p: { x: number; y: number }) => project(p.x, p.y)));
            fillPolygon(raster, rings);
            traceOutline(raster, rings);
            stats.polygons[key] = (stats.polygons[key] ?? 0) + 1;
          }
        }
      }
    }
  }
  for (let i = 0; i < raster.inside.length; i++) if (raster.inside[i]) raster.touched[i] = 1;
  return { raster, stats };
}

export function centerSample(r: LandRaster, x: number, y: number): number {
  const half = (r.samplesPerCell - 1) / 2;
  return (y * r.samplesPerCell + half) * r.width + x * r.samplesPerCell + half;
}

export function landAtCellCenter(r: LandRaster, x: number, y: number): boolean {
  return r.inside[centerSample(r, x, y)] === 1;
}

export function cellShare(r: LandRaster, mask: Uint8Array, x: number, y: number): number {
  const s = r.samplesPerCell;
  let count = 0;
  for (let j = y * s; j < (y + 1) * s; j++) for (let i = x * s; i < (x + 1) * s; i++) count += mask[j * r.width + i];
  return count / (s * s);
}

function touchedAt(r: LandRaster, i: number, j: number): boolean {
  return r.touched[j * r.width + i] === 1;
}

export function segmentOverLand(r: LandRaster, ax: number, ay: number, bx: number, by: number): boolean {
  const s = r.samplesPerCell;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * s * OUTLINE_STEPS_PER_SAMPLE));
  for (let k = 0; k <= steps; k++) {
    const i = Math.floor((ax + 0.5 + ((bx - ax) * k) / steps) * s);
    const j = Math.floor((ay + 0.5 + ((by - ay) * k) / steps) * s);
    if (i >= 0 && j >= 0 && i < r.width && j < r.height && r.inside[j * r.width + i]) return true;
  }
  return false;
}

export function moveCrossesLand(r: LandRaster, ax: number, ay: number, bx: number, by: number): boolean {
  const s = r.samplesPerCell;
  const half = (s - 1) / 2;
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  let i = ax * s + half;
  let j = ay * s + half;
  for (let step = 1; step <= s; step++) {
    if (dx && dy && (touchedAt(r, i + dx, j) || touchedAt(r, i, j + dy))) return true;
    i += dx;
    j += dy;
    if (step < s && touchedAt(r, i, j)) return true;
  }
  return false;
}
