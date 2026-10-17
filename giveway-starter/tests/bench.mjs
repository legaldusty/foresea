import fs from 'node:fs';
import { buildHarbor } from '../src/engine/harbor.js';
import { runNights } from '../src/engine/bench.js';
const h = buildHarbor(JSON.parse(fs.readFileSync('src/data/harbor_grid.json')), JSON.parse(fs.readFileSync('src/data/harbor.json')));
const nights = +(process.argv[2] || 300);
const betas = (process.argv[3] || '0.8,1.3,2.0').split(',').map(Number);
for (const beta of betas) {
  const t = Date.now();
  const r = runNights(h, { nights, seed: 7, tellOpts: { beta } });
  const f = (s) => `${s.tellWarnMin.toFixed(1)} vs ${s.baseWarnMin.toFixed(1)} min | right ${(s.tellCalledRight*100).toFixed(0)}% | wrong calls/night ${s.wrongCallsPerNight.toFixed(2)}`;
  console.log(`beta=${beta}  (${Date.now()-t} ms, trip avg ${r.all.tripMin.toFixed(1)} min)`);
  for (const k of ['all','direct','sloppy','decoy']) console.log('  ', k.padEnd(7), f(r[k]));
}
