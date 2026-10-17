import { describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { forecastPaths } from '../src/engine/forecast';
import { buildNoticeArea, planBoat, overlapShare, fixInstruction, type PlannerBoat, type PlannerRules } from '../src/engine/conflicts';

const h = buildHarbor(gridJson as never, defaultSettings);
const g = h.grid;
const gate = h.spawns.find((s) => s.name === 'Outside Angels Gate')!.cell;
const fuel = h.targets.findIndex((t) => t.id === 'fuel');
const odds = h.targets.map((_, i) => (i === fuel ? 1 : 0));
const forecast = forecastPaths(g, h.fields, { cell: gate, speedMps: 1.6, targetOdds: odds, lost: 0, drift: 0, current: null }, { samples: 300 });
const area = buildNoticeArea(g, forecast, gate, 1.6, { horizonMinutes: 30, zoneMeters: 250, carefulShare: 0.125, exitMinutesMax: 5 }, 0);
const rules: PlannerRules = { padMinutes: 3, p1Minutes: 5, p2Minutes: 15, maxDelayPerBoatMin: 8, minSlowKnots: 3, stepAsideMaxMeters: 1500, searchStepMinutes: 0.5 };

function redCellWithWindow(from: number, to: number): number {
  for (let j = 0; j < area.likely.length; j++) if (area.likely[j] && area.early[j] >= from && area.late[j] <= to) return j;
  throw new Error('no red cell with that window');
}

function boat(route: number[], extra: Partial<PlannerBoat> = {}): PlannerBoat {
  return { id: 'b', name: 'Test boat', route, speedMps: 4, waitIndex: -1, waitUntilMin: 0, slowUntilIndex: -1, slowMps: 4, movable: true, alongside: false, ...extra };
}

describe('conflicts need both place and time', () => {
  it('a boat that passes the drone path long before the drone gets there gets no action', () => {
    const cell = redCellWithWindow(18, 27);
    const next = g.neighbors[cell][0];
    const plan = planBoat(g, area, boat([cell, next]), 0, rules);
    expect(plan.crossing).toBeNull();
    expect(plan.priority).toBe('P4');
    expect(plan.action).toBe('none');
  });

  it('a boat that waits where the drone arrives within minutes is P1 and gets a gentle fix', () => {
    const cell = redCellWithWindow(2, 7);
    const next = g.neighbors[cell][0];
    const plan = planBoat(g, area, boat([cell, next], { waitIndex: 0, waitUntilMin: 12 }), 0, rules);
    expect(plan.crossing?.layer).toBe('likely');
    expect(plan.priority).toBe('P1');
    expect(plan.options.length).toBe(4);
    if (plan.fix) {
      expect(plan.fix.addedMin).toBeLessThanOrEqual(rules.maxDelayPerBoatMin);
      expect(fixInstruction(plan.fix, plan.action)).not.toBe('NO ACTION NEEDED');
    } else {
      expect(plan.noGentleOption).toBe(true);
    }
  });

  it('the area is the next 30 minutes of the forecast plus a keep-clear circle at the contact', () => {
    expect(area.likely[gate]).toBe(1);
    for (let j = 0; j < area.careful.length; j++) if (area.careful[j]) expect(area.early[j]).toBeLessThanOrEqual(30);
    expect(area.careful[h.targets[fuel].cell]).toBe(0);
  });

  it('overlap share measures how much of the fresh likely area sits inside the published one', () => {
    expect(overlapShare(area.likely, area.likely)).toBe(1);
    expect(overlapShare(area.likely, new Uint8Array(area.likely.length))).toBe(0);
  });
});
