import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld } from '../src/engine/world';
const h = buildHarbor(gridJson as never, defaultSettings);
const w = createWorld({ harbor: h, settings: defaultSettings });
w.resetHarbor('tuesday');
w.captainJoin('ferry1');
for (let i = 0; i < 4; i++) w.tick(250, Date.now());
const d = w.dropZone({ kind: 'whale', lonlat: [-118.262, 33.716] })!;
const draft = w.drafts.get(d)!;
console.log('plan', draft.plan.comparison.chosen, draft.plan.boats.map((b) => `${b.name}:${b.action}:${b.priority}`).join(', '));
const nid = w.publish(d)!;
const n = w.notices.get(nid)!;
console.log('ferry entry', JSON.stringify({ ...n.perVessel.get('ferry1'), newRoute: n.perVessel.get('ferry1')?.newRoute?.length }));
console.log('captain newRoute', w.captainSnapshot('ferry1').vessel?.newRoute?.length, 'route', w.captainSnapshot('ferry1').vessel?.route?.length);
import { circleZone } from '../src/engine/zones';
import { rerouteAround, routeEntersMask } from '../src/engine/routing';
import { remainingRoute } from '../src/engine/craft';
const ferry = w.craft.find((c) => c.id === 'ferry1')!;
const cell = w.cellAt([-118.262, 33.716]);
for (const frac of [0.5, 0.6, 0.8]) {
  const core = circleZone(h.grid, cell, 500 * frac).mask;
  const route = remainingRoute(ferry);
  const r = rerouteAround(h.grid, route, core, ferry.speedMps);
  console.log('core', frac, 'enters', routeEntersMask(route, core), 'status', r.status, 'added', r.addedMin.toFixed(2));
}
