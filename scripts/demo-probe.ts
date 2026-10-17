import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld } from '../src/engine/world';
const h = buildHarbor(gridJson as never, defaultSettings);
const w = createWorld({ harbor: h, settings: defaultSettings });
w.setCurrent({ u: -0.05, v: -0.027, speedMps: 0.057, towardDeg: 242 });
w.resetHarbor('night');
for (const id of ['ferry1', 'tug1', 'dive1', 'water1', 'launch1']) w.captainJoin(id);
const c = w.spawn({ preset: 'driven' })!;
const fuel = h.targets.find((t) => t.id === 'fuel')!;
w.drive(c.id, [fuel.lon, fuel.lat]);
let drafted = false;
for (let i = 0; i < 2400; i++) {
  w.tick(250, Date.now());
  const s = w.commandSnapshot();
  const cv = s.contacts[0];
  if (i % 20 === 0) console.log(s.clock.label, cv.odds.slice(0, 2).map((o) => `${o.name} ${Math.round(o.p * 100)}%`).join(', '), '| H', cv.hostility.H.toFixed(2), '| risk', cv.risk?.score, cv.risk?.level, '| eta', cv.eta?.minutes.toFixed(1), '| card', s.card?.title ?? '-');
  const fuelOdds = cv.odds.find((o) => o.id === 'fuel')?.p ?? 0;
  if (!drafted && s.drafts.length && fuelOdds >= 0.7) {
    drafted = true;
    const d = s.drafts[0];
    console.log('DRAFT at', s.clock.label, d.plan.comparison.chosen, '|', d.instructionText);
    for (const b of d.plan.boats) console.log('   ', b.name, b.priority, b.instruction, `+${b.addedMin.toFixed(1)}`, b.action, b.minutesToZone?.toFixed(1));
    const id = w.publish(d.id)!;
    for (let k = 0; k < 600; k++) {
      w.tick(250, Date.now());
      if (k % 40 === 0) {
        const s2 = w.commandSnapshot();
        const row = (v: string) => s2.deliveries.find((d) => d.vesselId === v);
        const l = row('launch1'), p = row('pilot1');
        console.log(s2.clock.label, 'launch1', l?.priority, l ? Object.keys(l.states).join('/') : '-', '| pilot1', p?.priority, p?.notResponding ? 'NOT RESPONDING' : '', '| card', s2.card?.title ?? '-');
      }
    }
    void id;
    break;
  }
}
