import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { findPath, type Grid, type GridJson } from '../src/engine/grid';
import { buildHarbor, type Harbor } from '../src/engine/harbor';
import { predictedPath } from '../src/engine/tell';
import { defaultSettings } from '../src/engine/settings';
import { gridFrame, landAtCellCenter, openChartTiles, rasterizeChartLand, segmentOverLand, type LandRaster } from './chart-land';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TILES_FILE = path.join(ROOT, 'public/tiles/harbor.pmtiles');
const FONT_DIR = path.join(ROOT, 'node_modules/@fontsource');
const CELL_METERS = 50;
const SAMPLES_PER_CELL = 21;
const AREA_CELLS = 48;
const AREA_SCALE = 12;
const OVERVIEW_SCALE = 3;
const DRAWN_ROUTE_EVERY = 3;

type Rgb = readonly [number, number, number];
const COLORS = {
  water: [0xf8, 0xfa, 0xf9], land: [0xe8, 0xdc, 0xc0], ink: [0x0f, 0x1b, 0x26], tide: [0x0f, 0x8b, 0x8d],
  wrong: [0xd8, 0x3a, 0x34], bg: [0xf6, 0xf3, 0xec],
} satisfies Record<string, Rgb>;

interface Area {
  file: string;
  title: string;
  lonlat: [number, number];
}

interface Panel {
  png: Buffer;
  waterOnLand: number;
  stepsOverLand: number;
}

interface CellWindow {
  x0: number;
  y0: number;
  width: number;
  height: number;
  scale: number;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(rows, y * (width * 3 + 1) + 1);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}

function blend(rgb: Uint8Array, at: number, color: Rgb, alpha: number): void {
  for (let c = 0; c < 3; c++) rgb[at + c] = Math.round(rgb[at + c] * (1 - alpha) + color[c] * alpha);
}

function harborRoutes(h: Harbor): number[][] {
  const routes: number[][] = [];
  for (const c of h.craft) {
    if (c.fromCell === undefined || c.toCell === undefined) continue;
    const route = findPath(h.grid, c.fromCell, c.toCell);
    if (route) routes.push(route);
  }
  const starts = [...h.spawns.map((s) => s.cell), ...h.gates.map((g) => g.cell)];
  for (const start of starts) h.targets.forEach((_, goal) => routes.push(predictedPath({ fields: h.fields, grid: h.grid }, goal, start)));
  return routes;
}

function stepsOverLand(r: LandRaster, g: Grid, route: number[], every: number, inside: (x: number, y: number) => boolean): number {
  let count = 0;
  const picks = route.filter((_, k) => k % every === 0 || k === route.length - 1);
  for (let k = 1; k < picks.length; k++) {
    const [ax, ay] = g.xy(picks[k - 1]);
    const [bx, by] = g.xy(picks[k]);
    if (!inside(ax, ay) && !inside(bx, by)) continue;
    if (segmentOverLand(r, ax, ay, bx, by)) count++;
  }
  return count;
}

function drawLine(rgb: Uint8Array, w: CellWindow, ax: number, ay: number, bx: number, by: number, color: Rgb): void {
  const pw = w.width * w.scale;
  const ph = w.height * w.scale;
  const px0 = (ax + 0.5 - w.x0) * w.scale;
  const py0 = (ay + 0.5 - w.y0) * w.scale;
  const px1 = (bx + 0.5 - w.x0) * w.scale;
  const py1 = (by + 0.5 - w.y0) * w.scale;
  const steps = Math.max(1, Math.ceil(Math.hypot(px1 - px0, py1 - py0) * 2));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(px0 + ((px1 - px0) * s) / steps);
    const y = Math.round(py0 + ((py1 - py0) * s) / steps);
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const X = x + dx;
      const Y = y + dy;
      if (X >= 0 && Y >= 0 && X < pw && Y < ph) blend(rgb, (Y * pw + X) * 3, color, 1);
    }
  }
}

function drawMarker(rgb: Uint8Array, w: CellWindow, g: Grid, lonlat: [number, number], cell: number): void {
  const pw = w.width * w.scale;
  const ph = w.height * w.scale;
  const put = (X: number, Y: number) => { if (X >= 0 && Y >= 0 && X < pw && Y < ph) blend(rgb, (Y * pw + X) * 3, COLORS.ink, 1); };
  const mx = Math.round(((lonlat[0] - g.bbox.west) / g.dlon - w.x0) * w.scale);
  const my = Math.round(((g.bbox.north - lonlat[1]) / g.dlat - w.y0) * w.scale);
  for (let d = -5; d <= 5; d++) { put(mx + d, my + d); put(mx + d, my - d); }
  const [cx, cy] = g.xy(cell);
  const left = (cx - w.x0) * w.scale;
  const top = (cy - w.y0) * w.scale;
  for (let d = 0; d < w.scale; d++) { put(left + d, top); put(left + d, top + w.scale - 1); put(left, top + d); put(left + w.scale - 1, top + d); }
}

function renderPanel(r: LandRaster, h: Harbor, routes: number[][], w: CellWindow): Panel {
  const g = h.grid;
  const s = r.samplesPerCell;
  const pw = w.width * w.scale;
  const ph = w.height * w.scale;
  const rgb = new Uint8Array(pw * ph * 3);
  const showCellLines = w.scale >= 8;
  for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
    const at = (py * pw + px) * 3;
    const cx = w.x0 + Math.floor(px / w.scale);
    const cy = w.y0 + Math.floor(py / w.scale);
    if (!g.inBounds(cx, cy)) { rgb.set(COLORS.bg, at); continue; }
    const sx = Math.floor((w.x0 + (px + 0.5) / w.scale) * s);
    const sy = Math.floor((w.y0 + (py + 0.5) / w.scale) * s);
    rgb.set(r.inside[sy * r.width + sx] ? COLORS.land : COLORS.water, at);
    const cellWater = g.water[g.idx(cx, cy)] === 1;
    if (!cellWater) blend(rgb, at, COLORS.ink, 0.3);
    else if (landAtCellCenter(r, cx, cy)) blend(rgb, at, COLORS.wrong, 0.6);
    if (showCellLines && (px % w.scale === 0 || py % w.scale === 0)) blend(rgb, at, COLORS.ink, 0.07);
  }
  const inWindow = (x: number, y: number) => x >= w.x0 && y >= w.y0 && x < w.x0 + w.width && y < w.y0 + w.height;
  let waterOnLand = 0;
  for (let y = w.y0; y < w.y0 + w.height; y++) for (let x = w.x0; x < w.x0 + w.width; x++) {
    if (g.inBounds(x, y) && g.water[g.idx(x, y)] && landAtCellCenter(r, x, y)) waterOnLand++;
  }
  let overLand = 0;
  for (const route of routes) {
    overLand += stepsOverLand(r, g, route, 1, inWindow);
    for (let k = 1; k < route.length; k++) {
      const [ax, ay] = g.xy(route[k - 1]);
      const [bx, by] = g.xy(route[k]);
      if (inWindow(ax, ay) || inWindow(bx, by)) drawLine(rgb, w, ax, ay, bx, by, COLORS.tide);
    }
  }
  for (const p of [...h.targets, ...h.spawns, ...h.gates, ...h.places]) drawMarker(rgb, w, g, [p.lon, p.lat], p.cell);
  return { png: encodePng(pw, ph, rgb), waterOnLand, stepsOverLand: overLand };
}

function fontFace(family: string, file: string, weight: number): string {
  const data = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
}

const FONTS = [
  fontFace('IBM Plex Sans', 'ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 400),
  fontFace('IBM Plex Sans', 'ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 600),
  fontFace('IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 400),
].join('\n');

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const mix = (c: Rgb, over: Rgb, alpha: number): Rgb => c.map((v, k) => Math.round(v * (1 - alpha) + over[k] * alpha)) as unknown as Rgb;

function pageHtml(title: string, meta: string, before: Panel, after: Panel, beforeLabel: string, afterLabel: string): string {
  const figure = (p: Panel, label: string) => `
    <figure>
      <img src="data:image/png;base64,${p.png.toString('base64')}">
      <figcaption><strong>${label}</strong><span>Water cells on drawn land <b>${p.waterOnLand}</b></span><span>Route and forecast steps across drawn land <b>${p.stepsOverLand}</b></span></figcaption>
    </figure>`;
  const key = (color: Rgb, text: string) => `<li><i style="background:${hex(color)}"></i>${text}</li>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${FONTS}
    * { box-sizing: border-box; margin: 0; }
    body { background: ${hex(COLORS.bg)}; color: ${hex(COLORS.ink)}; font-family: 'IBM Plex Sans', sans-serif; }
    main { display: inline-block; padding: 24px; }
    h1 { font-size: 22px; font-weight: 600; }
    p { font-size: 14px; margin: 4px 0 16px; color: #5B6B78; max-width: 1180px; }
    .panels { display: flex; gap: 24px; }
    figure { display: flex; flex-direction: column; gap: 8px; }
    img { display: block; border: 1px solid #D9D2C3; image-rendering: pixelated; }
    figcaption { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
    figcaption strong { font-weight: 600; font-size: 14px; }
    b { font-family: 'IBM Plex Mono', monospace; font-weight: 400; font-variant-numeric: tabular-nums; }
    ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 16px; font-size: 13px; }
    li { display: flex; align-items: center; gap: 6px; }
    li i { display: inline-block; width: 14px; height: 14px; border: 1px solid #D9D2C3; }
  </style></head><body><main>
    <h1>${title}</h1>
    <p>${meta}</p>
    <div class="panels">${figure(before, beforeLabel)}${figure(after, afterLabel)}</div>
    <ul>
      ${key(COLORS.water, 'Chart water')}
      ${key(COLORS.land, 'Chart land (earth, piers, platforms at z15)')}
      ${key(mix(COLORS.land, COLORS.ink, 0.3), 'Grid land cell')}
      ${key(mix(COLORS.water, COLORS.wrong, 0.6), 'Grid water cell whose center is drawn land')}
      ${key(COLORS.tide, 'Craft routes and forecasts from the gates')}
      ${key(COLORS.ink, 'Place in settings, with the cell it snaps to')}
    </ul>
  </main></body></html>`;
}

function drawnChordsOverLand(r: LandRaster, h: Harbor, routes: number[][]): { chords: number; overLand: number; stepsOverLand: number } {
  const everywhere = () => true;
  let chords = 0;
  for (const route of routes) chords += Math.ceil((route.length - 1) / DRAWN_ROUTE_EVERY);
  const overLand = routes.reduce((sum, route) => sum + stepsOverLand(r, h.grid, route, DRAWN_ROUTE_EVERY, everywhere), 0);
  const steps = routes.reduce((sum, route) => sum + stepsOverLand(r, h.grid, route, 1, everywhere), 0);
  return { chords, overLand, stepsOverLand: steps };
}

async function main(): Promise<number> {
  const oldFile = argValue('old');
  if (!oldFile) {
    console.error('Pass the grid to compare against: --old <file>, for example a copy of src/data/harbor_grid.json from before the rebuild.');
    return 1;
  }
  const newFile = path.resolve(argValue('new') ?? path.join(ROOT, 'src/data/harbor_grid.json'));
  const outDir = path.resolve(argValue('out') ?? path.join(ROOT, 'design/renders'));
  const before = buildHarbor(JSON.parse(fs.readFileSync(path.resolve(oldFile), 'utf8')) as GridJson, defaultSettings);
  const after = buildHarbor(JSON.parse(fs.readFileSync(newFile, 'utf8')) as GridJson, defaultSettings);
  const tiles = openChartTiles(TILES_FILE);
  const zoom = (await tiles.getHeader()).maxZoom;
  const [west, south, east, north] = defaultSettings.map.bbox;
  const { raster } = await rasterizeChartLand(tiles, gridFrame({ west, south, east, north }, CELL_METERS), zoom, SAMPLES_PER_CELL);
  const beforeRoutes = harborRoutes(before);
  const afterRoutes = harborRoutes(after);
  const h = defaultSettings.harbor;
  const target = (id: string) => h.targets.find((t) => t.id === id)!;
  const gate = (name: string) => h.gates.find((g) => g.name === name)!;
  const areas: Area[] = [
    { file: 'grid-pier400.png', title: 'Pier 400', lonlat: [target('pier400').lon, target('pier400').lat] },
    { file: 'grid-fuel-pier.png', title: 'Fuel Pier', lonlat: [target('fuel').lon, target('fuel').lat] },
    { file: 'grid-angels-gate.png', title: 'Angels Gate', lonlat: [gate('Angels Gate').lon, gate('Angels Gate').lat] },
    { file: 'grid-queens-gate.png', title: 'Queens Gate', lonlat: [gate('Queens Gate').lon, gate('Queens Gate').lat] },
    {
      file: 'grid-research-cruise.png', title: 'Research Dock and Cruise Terminal',
      lonlat: [(target('research').lon + target('cruise').lon) / 2, (target('research').lat + target('cruise').lat) / 2],
    },
  ];
  const beforeLabel = 'Before: OpenStreetMap land polygons via roaring-landmask, hand-placed breakwaters';
  const afterLabel = `After: built from the chart tiles at z${zoom}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  fs.mkdirSync(outDir, { recursive: true });
  const shoot = async (file: string, html: string) => {
    await page.setViewportSize({ width: 2000, height: 1000 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('main').screenshot({ path: path.join(outDir, file) });
    console.log(`Wrote ${path.relative(ROOT, path.join(outDir, file))}`);
  };
  for (const area of areas) {
    const [cx, cy] = after.grid.toCell(area.lonlat[0], area.lonlat[1]);
    const w: CellWindow = { x0: cx - AREA_CELLS / 2, y0: cy - AREA_CELLS / 2, width: AREA_CELLS, height: AREA_CELLS, scale: AREA_SCALE };
    const meta = `${AREA_CELLS} x ${AREA_CELLS} cells of ${CELL_METERS} m (${(AREA_CELLS * CELL_METERS) / 1000} km square) centered on ${area.title}. The left panel is the grid the engine used before; the right panel is the grid rebuilt from the same tiles the chart draws.`;
    await shoot(area.file, pageHtml(area.title, meta, renderPanel(raster, before, beforeRoutes, w), renderPanel(raster, after, afterRoutes, w), beforeLabel, afterLabel));
  }
  const whole: CellWindow = { x0: 0, y0: 0, width: after.grid.nx, height: after.grid.ny, scale: OVERVIEW_SCALE };
  const overviewMeta = `The whole engine grid, ${after.grid.nx} x ${after.grid.ny} cells of ${CELL_METERS} m, over the chart land.`;
  await shoot('grid-overview.png', pageHtml('San Pedro Bay', overviewMeta, renderPanel(raster, before, beforeRoutes, whole), renderPanel(raster, after, afterRoutes, whole), beforeLabel, afterLabel));
  await browser.close();
  for (const [label, harbor, routes] of [['before', before, beforeRoutes], ['after', after, afterRoutes]] as const) {
    const d = drawnChordsOverLand(raster, harbor, routes);
    console.log(`${label}: ${routes.length} routes, ${d.stepsOverLand} cell steps over drawn land, ${d.overLand} of ${d.chords} drawn segments (every ${DRAWN_ROUTE_EVERY} cells) over drawn land`);
  }
  return 0;
}

main().then((code) => process.exit(code));
