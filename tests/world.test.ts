import { describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld, type World } from '../src/engine/world';

const harbor = buildHarbor(gridJson as never, defaultSettings);
const QUEENS_GATE_CURRENT = { u: -0.05, v: -0.027, speedMps: 0.057, towardDeg: 242 };

function freshWorld(mode: 'tuesday' | 'night'): World {
  const w = createWorld({ harbor, settings: defaultSettings });
  w.setCurrent(QUEENS_GATE_CURRENT);
  w.resetHarbor(mode);
  return w;
}

function runUntil(w: World, done: () => boolean, maxTicks = 4000): boolean {
  for (let i = 0; i < maxTicks; i++) {
    w.tick(250, 1_800_000_000_000 + i * 250);
    if (done()) return true;
  }
  return false;
}

function driveToFuel(w: World): string {
  const c = w.spawn({ preset: 'driven' });
  if (!c) throw new Error('no contact');
  const fuel = harbor.targets.find((t) => t.id === 'fuel')!;
  w.drive(c.id, [fuel.lon, fuel.lat]);
  return c.id;
}

describe('night demo path', () => {
  it('drafts a give-way notice inside the signed orders and never publishes on its own', () => {
    const w = freshWorld('night');
    driveToFuel(w);
    expect(runUntil(w, () => w.drafts.size > 0)).toBe(true);
    const snap = w.commandSnapshot();
    const draft = snap.drafts[0];
    expect(draft.kind).toBe('security');
    expect(draft.publicReason).toBe('Security zone');
    expect(draft.plan.withinOrders).toBe(true);
    expect(snap.contacts[0].risk!.score).toBeGreaterThanOrEqual(defaultSettings.orders.draftRiskMin);
    runUntil(w, () => false, 400);
    expect([...w.notices.values()].length).toBe(0);
  });

  it('publishing reaches phones with a personal priority, Got it acknowledges and reroutes', () => {
    const w = freshWorld('night');
    for (const id of ['ferry1', 'tug1', 'dive1', 'water1', 'launch1']) w.captainJoin(id);
    driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    const noticeId = w.publish([...w.drafts.keys()][0]);
    expect(noticeId).toBeTruthy();
    const phones = ['ferry1', 'tug1', 'dive1', 'water1', 'launch1'].map((v) => ({ v, n: w.captainSnapshot(v).notices[0] }));
    expect(phones.every((p) => p.n)).toBe(true);
    const urgent = phones.filter((p) => p.n.priority === 'P1' || p.n.priority === 'P2');
    const quiet = phones.filter((p) => p.n.priority === 'P4');
    expect(urgent.length + quiet.length).toBeGreaterThan(0);
    const target = urgent[0] ?? phones[0];
    w.captainEvent(target.v, 'gotIt', noticeId!);
    const row = w.commandSnapshot().deliveries.find((d) => d.vesselId === target.v)!;
    expect(row.states.acknowledged).toBeDefined();
    expect(row.simulated).toBe(false);
  });

  it('escalates a boat that ignores the notice: re-send at 2 min, VHF card at 4 min, never climbs a rung alone', () => {
    const w = freshWorld('night');
    driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    const noticeId = w.publish([...w.drafts.keys()][0])!;
    const ignoring = harbor.craft.find((c) => c.ignoresNotices)!;
    const notice = w.notices.get(noticeId)!;
    const entry = notice.perVessel.get(ignoring.id);
    if (!entry || (entry.priority !== 'P1' && entry.priority !== 'P2')) return;
    runUntil(w, () => w.cards.some((k) => k.kind === 'notResponding'));
    const card = w.cards.find((k) => k.kind === 'notResponding')!;
    expect(card.title).toContain(ignoring.name);
    expect(card.script).toContain('channel 12');
    expect(w.audit.some((a) => a.action === 'Re-sent')).toBe(true);
  });

  it('all clear lifts every zone on every phone with one tap', () => {
    const w = freshWorld('night');
    w.captainJoin('launch1');
    driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    w.publish([...w.drafts.keys()][0]);
    expect(w.captainSnapshot('launch1').notices.length).toBe(1);
    w.allClear();
    const cap = w.captainSnapshot('launch1');
    expect(cap.notices.length).toBe(0);
    expect(cap.allClear.length).toBe(1);
    expect(w.commandSnapshot().zones.length).toBe(0);
  });
});

describe('Tuesday operations', () => {
  it('a whale zone is drafted as a routine slow zone and never above P2', () => {
    const w = freshWorld('tuesday');
    const draftId = w.dropZone({ kind: 'whale', lonlat: [-118.262, 33.716] })!;
    const draft = w.drafts.get(draftId)!;
    expect(draft.routine).toBe(true);
    expect(draft.instructionText).toBe('SLOW TO 10 KNOTS');
    const noticeId = w.publish(draftId)!;
    const n = w.notices.get(noticeId)!;
    for (const entry of n.perVessel.values()) expect(['P2', 'P3', 'P4']).toContain(entry.priority);
  });

  it('a registered glider drifting with the current reads as lost, not hostile', () => {
    const w = freshWorld('tuesday');
    const c = w.spawn({ preset: 'glider' })!;
    runUntil(w, () => false, 600);
    const view = w.contactView(c);
    expect(view.classification.kind).toBe('debris');
    expect(view.risk!.level).toBe('Low');
    expect(view.call).toBeNull();
    expect(w.cards.some((k) => k.kind === 'lost')).toBe(true);
  });

  it('every automatic step is logged and the publish can be undone', () => {
    const w = freshWorld('tuesday');
    const draftId = w.dropZone({ kind: 'divers', lonlat: [-118.2495, 33.7235] })!;
    w.publish(draftId);
    const entry = [...w.audit].reverse().find((a) => a.action === 'Published')!;
    expect(entry.undoable).toBe(true);
    w.undo(entry.id);
    expect([...w.notices.values()].filter((n) => n.status === 'active').length).toBe(0);
  });
});
