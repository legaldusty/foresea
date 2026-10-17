import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createTell, observe, proximityPrior, targetOdds, lostOnlyOdds } from '../src/engine/tell';
import { rng } from '../src/engine/bench';
import { forecastPaths } from '../src/engine/forecast';
const h = buildHarbor(gridJson as never, defaultSettings); const g = h.grid;
const r = rng(99);
const styles = [{ name: 'direct', sloppy: 0.15 }, { name: 'sloppy', sloppy: 0.9 }, { name: 'decoy', sloppy: 0.3, decoy: true }];
const stats: Record<string, { inL: number; inC: number; n: number; time: number; tn: number; winHit: number; winN: number }> = {};
let ms = 0, calls = 0;
const nights = Number(process.argv[2] ?? 45);
for (let night = 0; night < nights; night++) {
  const st = styles[night % 3]; const key = st.name;
  stats[key] ??= { inL: 0, inC: 0, n: 0, time: 0, tn: 0, winHit: 0, winN: 0 };
  const goal = Math.floor(r() * h.targets.length);
  const spawn = h.spawns[Math.floor(r() * h.spawns.length)].cell;
  let decoy = -1; if (st.decoy) { do { decoy = Math.floor(r() * h.targets.length); } while (decoy === goal); }
  const D = h.fields[goal]; const total = D[spawn];
  let cell = spawn; const track = [cell]; let decoyDone = !st.decoy; let guard = 0;
  while (D[cell] > 1.5 && guard++ < 3000) {
    if (!decoyDone && (h.fields[decoy][cell] <= 3 || guard > 0.5 * total)) decoyDone = true;
    const F = decoyDone ? D : h.fields[decoy];
    const nb = g.neighbors[cell]; let best = -1, bs = Infinity;
    for (let k = 0; k < nb.length; k += 2) { const sc = nb[k + 1] + F[nb[k]] + st.sloppy * 2.5 * r(); if (sc < bs) { bs = sc; best = nb[k]; } }
    track.push(best); cell = best;
  }
  const T = createTell(g, h.targets, { fields: h.fields }); proximityPrior(T, spawn);
  const speed = 1.6; const secPerCell = g.cellMeters / speed;
  const checkpoints = [0.1, 0.3, 0.5, 0.7].map((f) => Math.floor(track.length * f));
  for (let s = 1; s < track.length; s++) {
    observe(T, track[s - 1], track[s]);
    if (!checkpoints.includes(s)) continue;
    const t0 = performance.now();
    const f = forecastPaths(g, h.fields, { cell: track[s], speedMps: speed, targetOdds: targetOdds(T), lost: lostOnlyOdds(T), drift: 0, current: null }, { samples: 600, seed: night * 7 + s });
    ms += performance.now() - t0; calls++;
    let elapsed = 0;
    for (let k = s + 1; k < track.length && elapsed < 30 * 60; k++) {
      elapsed += secPerCell; const c = track[k];
      stats[key].n++; if (f.likely[c]) stats[key].inL++; if (f.likely[c] || f.passShare[c] >= 0.125) stats[key].inC++;
      if (!isNaN(f.timeEarly[c])) { stats[key].winN++; const m = elapsed / 60; if (m >= f.timeEarly[c] - 3 && m <= f.timeLate[c] + 3) stats[key].winHit++; }
    }
  }
}
for (const [k, v] of Object.entries(stats)) console.log(k.padEnd(7), 'true path inside red', (100 * v.inL / v.n).toFixed(0) + '%', '| inside yellow', (100 * v.inC / v.n).toFixed(0) + '%', '| time window right (±3 min)', (100 * v.winHit / v.winN).toFixed(0) + '%');
console.log('avg forecast ms', (ms / calls).toFixed(0));
