import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceField, loadGrid, type Grid, type GridJson } from '../src/engine/grid';
import { buildHarbor, checkReachability, type Harbor } from '../src/engine/harbor';
import { metersBetween, type LonLat } from '../src/engine/geo';
import { defaultSettings } from '../src/engine/settings';
import {
  CHART_LAND_LAYERS, cellShare, gridFrame, landAtCellCenter, layersMissingFromChart, moveCrossesLand, openChartTiles, rasterizeChartLand,
  type LandRaster,
} from './chart-land';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TILES_FILE = path.join(ROOT, 'public/tiles/harbor.pmtiles');
const CHART_MAP_FILE = path.join(ROOT, 'src/app/map/ChartMap.tsx');
const GRID_FILE = path.join(ROOT, 'src/data/harbor_grid.json');
const CELL_METERS = 50;
const SAMPLES_PER_CELL = 21;
const GRID_NAME = 'San Pedro Bay (Ports of Los Angeles & Long Beach)';
const BREAKWATER_LINES: Record<string, LonLat[]> = {
  'San Pedro Breakwater': [[-118.283, 33.7097], [-118.2733, 33.7057], [-118.2695, 33.7039], [-118.2652, 33.7039], [-118.2517, 33.7084]],
  'Middle Breakwater': [[-118.2446, 33.7107], [-118.207, 33.7232], [-118.1868, 33.7232]],
  'Long Beach Breakwater': [[-118.1804, 33.7232], [-118.14, 33.7232]],
};
const NEIGHBOR_MOVES: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [1, 1], [-1, 1]];

interface Classified {
  water: Uint8Array;
  landAtCenter: number;
  closedForThinLand: number[];
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function classifyCells(r: LandRaster): Classified {
  const { nx, ny } = r.frame;
  const water = new Uint8Array(nx * ny);
  let landAtCenter = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (landAtCellCenter(r, x, y)) landAtCenter++;
    else water[y * nx + x] = 1;
  }
  const landShare = (i: number) => cellShare(r, r.touched, i % nx, Math.floor(i / nx));
  const closedForThinLand: number[] = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = y * nx + x;
    for (const [dx, dy] of NEIGHBOR_MOVES) {
      if (!water[a]) break;
      const bx = x + dx;
      const by = y + dy;
      if (bx < 0 || bx >= nx || by >= ny) continue;
      const b = by * nx + bx;
      if (!water[b]) continue;
      const corners = dx !== 0 && dy !== 0 ? [y * nx + bx, by * nx + x] : [];
      if (corners.some((c) => !water[c])) continue;
      if (!moveCrossesLand(r, x, y, bx, by)) continue;
      const closed = [a, b, ...corners].reduce((best, c) => (landShare(c) > landShare(best) ? c : best));
      water[closed] = 0;
      closedForThinLand.push(closed);
    }
  }
  return { water, landAtCenter, closedForThinLand };
}

function encodeRows(water: Uint8Array, nx: number, ny: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < ny; y++) {
    const runs: number[] = [];
    let current = 1;
    let count = 0;
    for (let x = 0; x < nx; x++) {
      const value = water[y * nx + x];
      if (value === current) { count++; continue; }
      runs.push(count);
      current = value;
      count = 1;
    }
    runs.push(count);
    rows.push(runs);
  }
  return rows;
}

function partialCells(r: LandRaster, water: Uint8Array): { water: number; land: number } {
  const { nx, ny } = r.frame;
  const out = { water: 0, land: 0 };
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const share = cellShare(r, r.inside, x, y);
    if (share <= 0 || share >= 1) continue;
    if (water[y * nx + x]) out.water++;
    else out.land++;
  }
  return out;
}

function waterBeyondGates(h: Harbor): { pockets: number; cells: number } {
  const g = h.grid;
  const seen = new Uint8Array(g.nx * g.ny);
  const flood = (start: number) => {
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const nb = g.neighbors[queue[head]];
      for (let k = 0; k < nb.length; k += 2) if (!seen[nb[k]]) { seen[nb[k]] = 1; queue.push(nb[k]); }
    }
    return queue.length;
  };
  for (const gate of h.gates) if (!seen[gate.cell]) flood(gate.cell);
  const out = { pockets: 0, cells: 0 };
  for (let i = 0; i < g.water.length; i++) if (g.water[i] && !seen[i]) { out.pockets++; out.cells += flood(i); }
  return out;
}

function cellLonLat(g: Grid, cell: number): LonLat {
  return g.toLonLat(...g.xy(cell)) as LonLat;
}

function placementReport(next: Harbor, previous: Harbor | null): { lines: string[]; problems: string[] } {
  const g = next.grid;
  const fromGates = next.gates.map((gate) => distanceField(g, gate.cell));
  const connected = (cell: number) => fromGates.every((D) => Number.isFinite(D[cell]));
  const problems: string[] = [];
  const lines: string[] = [];
  const groups = [
    ['target', next.targets, previous?.targets],
    ['spawn', next.spawns, previous?.spawns],
    ['gate', next.gates, previous?.gates],
    ['place', next.places, previous?.places],
  ] as const;
  for (const [kind, items, before] of groups) {
    items.forEach((p, k) => {
      const offset = Math.round(metersBetween([p.lon, p.lat], cellLonLat(g, p.cell)));
      const prior = before?.[k];
      const moved = prior ? Math.round(metersBetween(cellLonLat(previous!.grid, prior.cell), cellLonLat(g, p.cell))) : null;
      const ok = connected(p.cell);
      if (!ok) problems.push(`${kind} ${p.name} is not connected to every gate`);
      lines.push(`   ${kind.padEnd(6)} ${p.name.padEnd(30)} water ${String(offset).padStart(4)} m from the spot${moved === null ? '' : `, ${String(moved).padStart(3)} m from its old cell`}, ${ok ? 'connected to every gate' : 'NOT CONNECTED'}`);
    });
  }
  for (const c of next.craft) {
    const ends = [c.fromCell, c.toCell];
    if (ends.some((cell) => cell === undefined)) problems.push(`craft ${c.name} has an unknown origin or destination`);
    else if (!ends.every((cell) => connected(cell as number))) problems.push(`craft ${c.name} runs between cells that are not connected to the gates`);
    else lines.push(`   craft  ${c.name.padEnd(30)} ${c.from} to ${c.to}, both connected`);
  }
  problems.push(...checkReachability(next));
  return { lines, problems };
}

function readGrid(file: string): GridJson | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as GridJson;
}

function flips(previous: GridJson, next: GridJson): { landToWater: number; waterToLand: number; previousWater: number } | null {
  if (previous.nx !== next.nx || previous.ny !== next.ny) return null;
  const a = loadGrid(previous).water;
  const b = loadGrid(next).water;
  const out = { landToWater: 0, waterToLand: 0, previousWater: 0 };
  for (let i = 0; i < a.length; i++) {
    out.previousWater += a[i];
    if (!a[i] && b[i]) out.landToWater++;
    if (a[i] && !b[i]) out.waterToLand++;
  }
  return out;
}

async function main(): Promise<number> {
  const missing = layersMissingFromChart(fs.readFileSync(CHART_MAP_FILE, 'utf8'));
  if (missing.length) {
    console.error(`The chart no longer fills land from ${missing.map((l) => l.sourceLayer).join(' and ')} the way this build expects. Update CHART_LAND_LAYERS in scripts/chart-land.ts to match src/app/map/ChartMap.tsx.`);
    return 1;
  }
  const tiles = openChartTiles(TILES_FILE);
  const header = await tiles.getHeader();
  const zoom = Number(argValue('zoom') ?? header.maxZoom);
  if (!Number.isInteger(zoom) || zoom < header.minZoom || zoom > header.maxZoom) {
    console.error(`Zoom ${zoom} is outside the tiles (z${header.minZoom} to z${header.maxZoom}).`);
    return 1;
  }
  const outFile = path.resolve(argValue('out') ?? GRID_FILE);
  const previousFile = path.resolve(argValue('previous') ?? outFile);
  const [west, south, east, north] = defaultSettings.map.bbox;
  const frame = gridFrame({ west, south, east, north }, CELL_METERS);
  const { raster, stats } = await rasterizeChartLand(tiles, frame, zoom, SAMPLES_PER_CELL);
  const { water, landAtCenter, closedForThinLand } = classifyCells(raster);
  const json: GridJson = {
    name: GRID_NAME,
    source: `Land and water: the chart's own Protomaps tiles (public/tiles/harbor.pmtiles, OpenStreetMap contributors, ODbL), ${CHART_LAND_LAYERS.map((l) => `${l.sourceLayer} ${l.kinds.join(' or ')}`).join(' and ')} polygons at z${zoom}, read at each cell center, with cells closed where a move to a neighbor would cross drawn land. Breakwater lines: traced by hand from the same chart land, used for the near-shore shading.`,
    bbox: frame.bbox,
    cellMeters: frame.cellMeters,
    nx: frame.nx,
    ny: frame.ny,
    dlon: frame.dlon,
    dlat: frame.dlat,
    rle: encodeRows(water, frame.nx, frame.ny),
    breakwaters: BREAKWATER_LINES,
  };
  const previous = readGrid(previousFile);
  const next = buildHarbor(json, defaultSettings);
  const before = previous ? buildHarbor(previous, defaultSettings) : null;
  const { lines, problems } = placementReport(next, before);
  const waterCount = water.reduce((sum, v) => sum + v, 0);
  const partial = partialCells(raster, water);
  const beyond = waterBeyondGates(next);
  const sampleMeters = (CELL_METERS / SAMPLES_PER_CELL).toFixed(1);

  console.log(`Chart land from ${path.relative(ROOT, TILES_FILE)} at z${zoom}: ${stats.tilesRead} tiles read, ${stats.tilesMissing} missing`);
  console.log(`   ${Object.entries(stats.polygons).map(([k, n]) => `${k} ${n}`).join(', ')} polygons`);
  console.log(`Grid ${frame.nx} x ${frame.ny} cells of ${CELL_METERS} m, ${SAMPLES_PER_CELL} x ${SAMPLES_PER_CELL} samples per cell (${sampleMeters} m)`);
  console.log(`   water cells ${waterCount} of ${frame.nx * frame.ny}`);
  console.log(`   land at the cell center ${landAtCenter}, closed so thin land stays whole ${closedForThinLand.length}`);
  console.log(`   partly land cells: ${partial.water} kept as water, ${partial.land} land`);
  console.log(`   water not connected to the gates: ${beyond.pockets} pockets, ${beyond.cells} cells`);
  const change = previous ? flips(previous, json) : null;
  if (change) console.log(`Against ${path.relative(ROOT, previousFile)}: water ${change.previousWater} to ${waterCount}, land to water ${change.landToWater}, water to land ${change.waterToLand}`);
  console.log('Places in settings/giveway.settings.json');
  for (const line of lines) console.log(line);
  if (problems.length) {
    console.error(`\nNot written. ${problems.length} problems:`);
    for (const p of problems) console.error(`   ${p}`);
    return 1;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(json));
  console.log(`\nWrote ${path.relative(ROOT, outFile)}`);
  return 0;
}

main().then((code) => process.exit(code));
