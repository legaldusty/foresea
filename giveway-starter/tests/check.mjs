import fs from 'node:fs';
import { buildHarbor, checkReachability } from '../src/engine/harbor.js';
import { distanceField } from '../src/engine/grid.js';
const h = buildHarbor(JSON.parse(fs.readFileSync('src/data/harbor_grid.json')), JSON.parse(fs.readFileSync('src/data/harbor.json')));
console.log('grid', h.grid.nx, 'x', h.grid.ny);
for (const t of [...h.targets, ...h.spawns]) { const [x,y]=h.grid.xy(t.cell); console.log((t.id||'spawn').padEnd(9), t.name.padEnd(28), x, y); }
console.log('problems:', checkReachability(h));
const D = distanceField(h.grid, h.targets[0].cell);
for (const s of h.spawns) console.log('dist cruise <-', s.name, (D[s.cell]*50/1000).toFixed(1), 'km');
