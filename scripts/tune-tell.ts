import fs from 'node:fs';
import path from 'node:path';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { distanceField, nearestWater, walkLine, pathLength } from '../src/engine/grid';

const file = process.argv[2] ?? path.join('data/recordings', defaultSettings.ais.recording);
const h = buildHarbor(gridJson as never, defaultSettings);
const g = h.grid;

interface Fix { t: number; lon: number; lat: number; sog: number }
const tracks = new Map<number, Fix[]>();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let rec: { t: number; m: { MessageType?: string; MetaData?: { MMSI?: number; latitude?: number; longitude?: number }; Message?: Record<string, { Sog?: number }> } };
  try { rec = JSON.parse(line); } catch { continue; }
  const m = rec.m;
  if (m.MessageType !== 'PositionReport' && m.MessageType !== 'StandardClassBPositionReport') continue;
  const meta = m.MetaData;
  if (!meta?.MMSI || meta.latitude === undefined || meta.longitude === undefined) continue;
  const sog = m.Message?.[m.MessageType]?.Sog ?? 0;
  const list = tracks.get(meta.MMSI) ?? [];
  list.push({ t: rec.t, lon: meta.longitude, lat: meta.latitude, sog });
  tracks.set(meta.MMSI, list);
}

function cellOf(f: Fix): number {
  const [x, y] = g.toCell(f.lon, f.lat);
  return g.inBounds(x, y) ? nearestWater(g, x, y, 3) : -1;
}

interface Track { mmsi: number; cells: number[] }
const usable: Track[] = [];
for (const [mmsi, fixes] of tracks) {
  const moving = fixes.filter((f) => f.sog >= 2);
  if (moving.length < 6) continue;
  const cells: number[] = [];
  for (const f of moving) {
    const c = cellOf(f);
    if (c < 0) continue;
    const last = cells[cells.length - 1];
    if (last === undefined) { cells.push(c); continue; }
    if (c === last) continue;
    const seg = walkLine(g, last, c);
    if (!seg.length || seg[seg.length - 1] !== c) continue;
    cells.push(...seg);
  }
  if (cells.length >= 12) usable.push({ mmsi, cells });
}

function logLikelihood(beta: number, D: Float32Array, cells: number[]): number {
  let ll = 0;
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k];
    const nb = g.neighbors[a];
    let z = 0, num = 0;
    for (let i = 0; i < nb.length; i += 2) {
      const adv = D[a] - (nb[i + 1] + D[nb[i]]);
      const w = Math.exp(beta * adv);
      z += w;
      if (nb[i] === b) num = w;
    }
    if (num > 0 && z > 0) ll += Math.log(num / z);
  }
  return ll;
}

const fields = usable.map((t) => distanceField(g, t.cells[t.cells.length - 1]));
const efficiency = usable.map((t, i) => { const D = fields[i]; const straight = D[t.cells[0]]; return straight > 0 ? pathLength(g, t.cells) / straight : 1; });
const betas = [0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.8, 2.2, 2.7, 3.3];
const scores = betas.map((b) => ({ beta: b, ll: usable.reduce((s, t, i) => s + logLikelihood(b, fields[i], t.cells), 0) }));
const best = scores.reduce((a, b) => (b.ll > a.ll ? b : a));
const moves = usable.reduce((s, t) => s + t.cells.length - 1, 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

console.log(`Recording: ${path.basename(file)}; ${tracks.size} vessels, ${usable.length} moving tracks, ${moves} grid moves`);
console.log(`Median path efficiency (sailed / shortest water route): ${median(efficiency).toFixed(2)}`);
for (const s of scores) console.log(`  beta ${s.beta.toFixed(1)}  mean log-likelihood per move ${(s.ll / Math.max(1, moves)).toFixed(3)}${s === best ? '  best' : ''}`);
console.log(`Best fit beta ${best.beta} against the setting ${defaultSettings.tell.beta}. Real vessels move at least this purposefully, so the setting is ${best.beta >= defaultSettings.tell.beta ? 'conservative' : 'more trusting than real traffic'}.`);
fs.mkdirSync('data/cache', { recursive: true });
fs.writeFileSync('data/cache/tell-fit.json', JSON.stringify({ file: path.basename(file), vessels: tracks.size, tracks: usable.length, moves, medianEfficiency: median(efficiency), scores, best: best.beta, setting: defaultSettings.tell.beta }, null, 2));
