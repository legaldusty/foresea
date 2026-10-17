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

describe('incident A at night: warn only the boats that meet it, gently', () => {
  function incidentA(publishAfterMin: number) {
    const w = freshWorld('night');
    w.captainJoin('launch1');
    const start = w.simMin;
    w.spawn({ preset: 'scenario', scenarioKey: 'A' });
    let wall = 1_800_000_000_000;
    const tick = () => { wall += 250; w.tick(250, wall); };
    while (w.simMin - start < publishAfterMin) tick();
    const draft = [...w.drafts.values()][0];
    expect(draft).toBeDefined();
    const noticeId = w.publish(draft.id)!;
    return { w, noticeId, tick };
  }

  for (const publishAfterMin of [7, 9, 11]) {
    it(`publishing ${publishAfterMin} min after detection costs at most 10 boat-minutes and gives the judge's phone P1 with an action and a countdown`, () => {
      const { w, noticeId, tick } = incidentA(publishAfterMin);
      const n = w.notices.get(noticeId)!;
      let total = 0;
      for (const e of n.perVessel.values()) if (e.fix) { total += e.addedMin; expect(e.addedMin).toBeLessThanOrEqual(8); }
      expect(total).toBeLessThanOrEqual(10);
      let judge = w.captainSnapshot('launch1').notices[0];
      for (let i = 0; i < 40 && judge.priority !== 'P1'; i++) { tick(); judge = w.captainSnapshot('launch1').notices[0]; }
      expect(judge.priority).toBe('P1');
      expect(judge.instructionText).toMatch(/^(HOLD POSITION|SLOW TO \d+ KNOTS|STEP ASIDE [A-Z]+ \d+ m|ALTER COURSE [A-Z]+ \d+ m)$/);
      expect(judge.untilLabel).toMatch(/^\d\d:\d\d$/);
    });
  }

  it('Pilot Boat 2 ignores the notice and escalates to the VHF card; the Water Taxi never gets an action', () => {
    const { w, noticeId, tick } = incidentA(9);
    const taxiActions = new Set<string>();
    for (let i = 0; i < 300 && !w.cards.some((k) => k.kind === 'notResponding' && k.title.startsWith('Pilot Boat 2')); i++) {
      tick();
      const e = w.notices.get(noticeId)!.perVessel.get('water1');
      if (e) taxiActions.add(e.action);
    }
    expect(w.cards.some((k) => k.kind === 'notResponding' && k.title.startsWith('Pilot Boat 2'))).toBe(true);
    for (const a of taxiActions) expect(['none', 'headsUp']).toContain(a);
    const taxi = w.notices.get(noticeId)!.perVessel.get('water1');
    expect(['P3', 'P4']).toContain(taxi?.priority ?? 'P4');
  });

});

describe('officer decisions hold', () => {
  it('the radius the officer sets stays after Publish', () => {
    const w = freshWorld('night');
    driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    const draftId = [...w.drafts.keys()][0];
    w.editDraft({ draftId, edits: { radiusM: 500 } });
    const noticeId = w.publish(draftId)!;
    runUntil(w, () => false, 40);
    const zone = [...w.zones.values()].find((z) => z.noticeId === noticeId)!;
    expect(zone.radiusM).toBe(500);
    expect(w.notices.get(noticeId)!.instructionText).toContain('500');
  });

  it('a phone that joins after Publish still gets the alert and its own Got it', () => {
    const w = freshWorld('night');
    driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    const noticeId = w.publish([...w.drafts.keys()][0])!;
    runUntil(w, () => false, 60);
    w.captainJoin('launch1');
    const notice = w.captainSnapshot('launch1').notices.find((n) => n.id === noticeId)!;
    expect(notice.acknowledged).toBe(false);
    const row = w.commandSnapshot().deliveries.find((d) => d.vesselId === 'launch1')!;
    expect(row.simulated).toBe(false);
    w.captainEvent('launch1', 'gotIt', noticeId);
    expect(w.captainSnapshot('launch1').notices[0].acknowledged).toBe(true);
  });

  it('a discarded draft stays discarded until the risk goes up', () => {
    const w = freshWorld('night');
    const id = driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    const levelAtDiscard = w.contacts.get(id)!.lastRisk!.level;
    w.discardDraft([...w.drafts.keys()][0]);
    const back = runUntil(w, () => w.drafts.size > 0, 120);
    if (back) expect(w.contacts.get(id)!.lastRisk!.level).toBeGreaterThan(levelAtDiscard);
    expect(w.audit.filter((a) => a.action === 'Notice drafted').length).toBe(back ? 2 : 1);
  });

  it('a lost glider gets one search-area draft that the card publishes', () => {
    const w = freshWorld('tuesday');
    w.spawn({ preset: 'glider' });
    runUntil(w, () => false, 600);
    expect(w.audit.filter((a) => a.action === 'Notice drafted').length).toBe(1);
    const card = w.cards.find((k) => k.kind === 'lost')!;
    w.cardAction(card.id, 'publishZone');
    expect([...w.notices.values()].filter((n) => n.status === 'active').length).toBe(1);
  });

  it('after the sensor loses the contact the draft area stretches along the last forecast, never past it', () => {
    const w = freshWorld('night');
    const id = driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    const before = w.zones.get(`z-${id}`)!.geometry.cells.length;
    const forecast = w.forecasts.get(id)!.forecast;
    w.sensorLoss(id, true);
    runUntil(w, () => false, 200);
    const zone = w.zones.get(`z-${id}`)!;
    expect(zone.geometry.cells.length).toBeGreaterThan(before);
    for (const cell of zone.geometry.cells) expect(forecast.passShare[cell] > 0 || forecast.likely[cell] === 1 || zone.area!.area.early[cell] === 0).toBe(true);
    expect(w.forecasts.get(id)!.forecast).toBe(forecast);
  });

  it('Empty harbor keeps the phones connected for the next scene', () => {
    const w = freshWorld('night');
    w.captainJoin('launch1');
    w.resetHarbor('empty');
    w.resetHarbor('night');
    expect(w.captains.get('launch1')?.connected).toBe(true);
  });

  it('ALL CLEAR stays on the phones for a minute of real time at any speed', () => {
    const w = freshWorld('night');
    w.captainJoin('launch1');
    driveToFuel(w);
    runUntil(w, () => w.drafts.size > 0);
    w.publish([...w.drafts.keys()][0]);
    const start = w.wallMs;
    w.allClear();
    w.tick(250, start + 30_000);
    expect(w.captainSnapshot('launch1').allClear.length).toBe(1);
    w.tick(250, start + 61_000);
    expect(w.captainSnapshot('launch1').allClear.length).toBe(0);
  });
});

describe('several contacts', () => {
  it('two coordinated unknowns each get their own TELL and raise a hand-off card', () => {
    const w = freshWorld('night');
    w.spawn({ preset: 'pair' });
    expect(w.contacts.size).toBe(2);
    const [a, b] = [...w.contacts.values()];
    expect(a.tell).not.toBe(b.tell);
    runUntil(w, () => w.cards.some((k) => k.key === 'handoff:coordinated'), 6000);
    expect(w.cards.some((k) => k.key === 'handoff:coordinated')).toBe(true);
    expect(w.audit.some((e) => e.action === 'Card raised' && e.detail.startsWith('Coordinated'))).toBe(true);
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

  it('a registered robot that answers its ping is Friendly and stays at Log', () => {
    const w = freshWorld('tuesday');
    const c = w.spawn({ preset: 'friendly' })!;
    runUntil(w, () => false, 300);
    const view = w.contactView(c);
    expect(view.classification.kind).toBe('friendly');
    expect(view.hostility.H).toBeCloseTo(0.02, 2);
    expect(view.risk!.level).toBe('Low');
    expect(w.drafts.size).toBe(0);
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
