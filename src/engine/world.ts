import type { Harbor } from './harbor';
import type { Settings } from './settings';
import { nearestWater, walkLine } from './grid';
import { topGoal, LOST, DRIFT, type CurrentVector } from './tell';
import { HIGH, CRITICAL, SERIOUS, levelName, rungName } from './risk';
import { INCIDENTS } from './scenarios';
import {
  createContact, moveContact, evaluateContact, contactLonLat, predictedPaths, oddsRows, setPointer, factors, etaToGoal, recordOdds,
  type ContactSim, type ContactSpec,
} from './contact';
import {
  createCraft, moveCraft, craftLonLat, remainingRoute, applyRoute, restoreRoute, currentCell, plannedArrivalMin, ourArrivalMin, fleetSeeds,
  type CraftSim,
} from './craft';
import { securityZone, circleZone, type ZoneGeometry } from './zones';
import { chooseResponse, instructionText, type Boat, type ResponsePlan, type Instruction } from './response';
import { dilate, rerouteAround, routeEntersMask } from './routing';
import { minutesUntilZone, priorityFor, lessUrgent, type Priority } from './priority';
import { templateWording, allClearWording, damagePhrase, reasonAt, type WordingFacts } from './wording';
import { rng } from './bench';
import { clockLabel, isNight, minutesLabel, signedMinutes } from './eta';
import { metersBetween, mpsToKnots, offsetPoint, bearingDeg, compassPoint, type LonLat } from './geo';
import type * as P from '../shared/protocol';

export interface AisInputVessel {
  mmsi: number;
  name: string;
  lat: number;
  lon: number;
  sogKn: number;
  cogDeg: number;
  headingDeg: number | null;
  typeLabel: string;
  lengthM: number | null;
  aisClass: 'A' | 'B';
  source: 'live' | 'replay' | string;
}

interface ZoneRec {
  id: string;
  kind: 'keepOut' | 'slow';
  reason: P.PublicReason;
  status: 'draft' | 'published';
  geometry: ZoneGeometry;
  radiusM: number;
  contactId: string | null;
  noticeId: string | null;
  draftId: string | null;
  movingTowardDeg: number | null;
  movingSpeedMps: number;
  centerCell: number;
}

interface DraftRec extends P.NoticeDraft {
  responsePlan: ResponsePlan | null;
  wordingKey: string;
  factsKey: string;
  wordingInFlight: boolean;
  officerRadius: number | null;
  officerInstruction: string | null;
}

interface VesselPlanEntry { priority: Priority; instruction: Instruction; instructionText: string; addedMin: number; minutesToZone: number | null; action: string; newRoute: number[] | null }

interface NoticeRec extends P.Notice {
  perVessel: Map<string, VesselPlanEntry>;
  responsePlan: ResponsePlan | null;
}

interface DeliveryRec extends P.DeliveryRow {
  ackAtMin: number | null;
  plannedSeen: number | null;
  plannedAck: number | null;
  plannedDelivered: number | null;
  vhfCalled: boolean;
}

interface CardRec extends P.Card {
  key: string;
  lastAlertMin: number;
  rank: number;
}

interface CaptainRec { vesselId: string; connected: boolean; lastSeenWall: string | null }

export interface WordingRequest { draftId: string; facts: WordingFacts; template: P.Wording; key: string }
export interface PushRequest { vesselId: string; title: string; body: string; tag: string; priority: Priority; url: string }

export interface ResendRequest { noticeId: string; vesselId: string; vesselName: string; priority: Priority; text: string }
export interface WorldEffects { audit: P.AuditEntry[]; pushes: PushRequest[]; wording: WordingRequest[]; undone: string[]; resends: ResendRequest[] }

export interface WorldOptions {
  harbor: Harbor;
  settings: Settings;
  station?: string;
  officer?: string;
  link?: string;
  seed?: number;
}

const CARD_RANK: Record<P.Card['kind'], number> = { person: 0, publish: 1, handoff: 2, notResponding: 3, hold: 4, animal: 5, lost: 6, info: 7 };
const STATION = 'Los Angeles Harbor Watch';
const NO_ARTICLE = /^(Angels Gate|Queens Gate|Pier \d+|the )/;
const withArticle = (name: string): string => (NO_ARTICLE.test(name) ? name : `the ${name}`);
const MAX_AUDIT = 400;

export class World {
  readonly h: Harbor;
  settings: Settings;
  station: string;
  officer: string;
  link: string;
  simMin = 9 * 60;
  timeScale: number;
  paused = false;
  wallMs = Date.now();
  current: CurrentVector | null = null;
  currentSpeedMps = 0;
  currentTowardDeg: number | null = null;
  cruiseDocked = true;
  cruiseShip: string | null = null;
  contacts = new Map<string, ContactSim>();
  craft: CraftSim[] = [];
  ais: (AisInputVessel & { cell: number })[] = [];
  zones = new Map<string, ZoneRec>();
  drafts = new Map<string, DraftRec>();
  notices = new Map<string, NoticeRec>();
  deliveries = new Map<string, DeliveryRec>();
  cards: CardRec[] = [];
  audit: P.AuditEntry[] = [];
  marineLog: P.MarineLogEntry[] = [];
  captains = new Map<string, CaptainRec>();
  allClearRecent: { id: string; publicReason: string; atWall: string; atMin: number; approvedBy: string }[] = [];
  lastAllClearMin: number | null = null;
  dismissed = new Set<string>();
  signedOrders: P.SignedOrders;
  sources: P.SourceStatus = {
    ais: { mode: 'offline', detail: 'Starting', vessels: 0 },
    noaa: { source: 'none', detail: 'Starting', currentKn: null, towardDeg: null, observedAt: null },
    language: { source: 'template', model: null, detail: 'Starting' },
    push: { ready: false, detail: 'Starting' },
  };
  private undoers = new Map<string, () => void>();
  private effects: WorldEffects = { audit: [], pushes: [], wording: [], undone: [], resends: [] };
  private seq = 0;
  private contactSeq = 13;
  private rand: () => number;
  private lastResponseMin = new Map<string, number>();

  constructor(o: WorldOptions) {
    this.h = o.harbor;
    this.settings = o.settings;
    this.station = o.station ?? STATION;
    this.officer = o.officer ?? 'Officer on watch';
    this.link = o.link ?? 'http://giveway.local/captain';
    this.timeScale = o.settings.sim.timeScale;
    this.rand = rng(o.seed ?? 41);
    this.signedOrders = { signedBy: null, signedAtWall: null, orders: { ...o.settings.orders } };
    this.resetHarbor('tuesday');
  }

  private id(prefix: string): string { return `${prefix}-${++this.seq}`; }

  private wall(): string { return new Date(this.wallMs).toISOString(); }

  get night(): boolean { return isNight(this.simMin, this.settings.sim.nightStartHour, this.settings.sim.nightEndHour); }

  private orders(): Settings['orders'] { return { ...this.settings.orders, ...this.signedOrders.orders } as Settings['orders']; }

  log(actor: string, action: string, detail: string, undo?: () => void): P.AuditEntry {
    const entry: P.AuditEntry = { id: this.id('a'), atMin: this.simMin, wall: this.wall(), actor, action, detail, undoable: !!undo, undone: false };
    this.audit.push(entry);
    if (this.audit.length > MAX_AUDIT) this.audit.shift();
    this.effects.audit.push(entry);
    if (undo) this.undoers.set(entry.id, undo);
    return entry;
  }

  drainEffects(): WorldEffects {
    const out = this.effects;
    this.effects = { audit: [], pushes: [], wording: [], undone: [], resends: [] };
    return out;
  }

  resetHarbor(mode: 'tuesday' | 'night' | 'empty'): void {
    this.contacts.clear();
    this.zones.clear();
    this.drafts.clear();
    this.notices.clear();
    this.deliveries.clear();
    this.cards = [];
    this.dismissed.clear();
    this.allClearRecent = [];
    this.simMin = mode === 'night' ? 2 * 60 : 9 * 60;
    const t = this.simMin;
    const r = rng(17);
    this.craft = [];
    if (mode !== 'empty') {
      for (const spec of this.h.craft) {
        if (spec.fromCell === undefined || spec.toCell === undefined) continue;
        const c = createCraft(this.h, {
          id: spec.id, name: spec.name, type: spec.type, speedKn: spec.speedKn, fromCell: spec.fromCell, toCell: spec.toCell,
          scheduledMin: spec.scheduledMin, phone: !!spec.phone, fleet: false, ignoresNotices: !!spec.ignoresNotices, startFraction: (spec as { startFraction?: number }).startFraction ?? 0.05 + 0.25 * r(),
        }, t);
        if (c) this.craft.push(c);
      }
      for (const seed of fleetSeeds(this.h, this.settings.delivery.simulatedFleetSize, 23)) {
        const c = createCraft(this.h, seed, t);
        if (c) this.craft.push(c);
      }
    }
    for (const cap of this.captains.values()) if (!this.craft.some((c) => c.id === cap.vesselId)) this.captains.delete(cap.vesselId);
    this.log('officer', 'Reset harbor', mode === 'night' ? 'Night watch, 02:00' : mode === 'tuesday' ? 'Tuesday operations, 09:00' : 'Empty harbor');
  }

  setCurrent(c: { u: number; v: number; speedMps: number; towardDeg: number } | null): void {
    this.current = c ? { currentU: c.u, currentV: c.v } : null;
    this.currentSpeedMps = c?.speedMps ?? 0;
    this.currentTowardDeg = c?.towardDeg ?? null;
  }

  setBerth(cruiseDocked: boolean, ship: string | null): void {
    if (cruiseDocked !== this.cruiseDocked) this.log('machine', 'Berth status', cruiseDocked ? `${ship ?? 'A cruise ship'} is berthed at the Cruise Terminal (AIS)` : 'Cruise Terminal berth is empty (AIS); consequence drops to 0.44');
    this.cruiseDocked = cruiseDocked;
    this.cruiseShip = ship;
  }

  setAis(vessels: AisInputVessel[]): void {
    const g = this.h.grid;
    this.ais = vessels.map((v) => {
      const [x, y] = g.toCell(v.lon, v.lat);
      const cell = g.inBounds(x, y) ? nearestWater(g, x, y, 4) : -1;
      return { ...v, cell };
    });
  }

  setSources(partial: Partial<P.SourceStatus>): void { this.sources = { ...this.sources, ...partial }; }

  cellAt(lonlat: LonLat): number {
    const [x, y] = this.h.grid.toCell(lonlat[0], lonlat[1]);
    return nearestWater(this.h.grid, Math.max(0, Math.min(this.h.grid.nx - 1, x)), Math.max(0, Math.min(this.h.grid.ny - 1, y)), 30);
  }

  lonlatOf(cell: number): LonLat { return this.h.grid.toLonLat(...this.h.grid.xy(cell)) as LonLat; }

  private spawnContact(spec: Omit<ContactSpec, 'id' | 'label' | 'firstSeenMin' | 'seed'> & { seed?: number }, nearness = true): ContactSim {
    const n = ++this.contactSeq;
    const full: ContactSpec = { ...spec, id: `C-${n}`, label: `Contact C-${n}`, firstSeenMin: this.simMin, seed: spec.seed ?? 100 + n };
    const c = createContact(this.h, this.settings, full, this.current, nearness);
    this.contacts.set(c.id, c);
    this.evaluate(c);
    const registered = full.registryId ? this.h.registry.find((r) => r.id === full.registryId) : null;
    this.log('machine', 'New contact', `${c.spec.label} seen at ${this.placeNear(c.cell)}: ${full.sizeM.toFixed(1)} m, ${full.speedMps.toFixed(1)} m/s, ${full.heat === 'hot' ? 'hot spot' : full.heat === 'warm' ? 'warm body' : 'no hot spot'}`);
    this.log('machine', 'Registry check', registered ? `${c.spec.label} matches ${registered.name} (${registered.owner})` : `${c.spec.label}: no registry or dive-plan match`);
    c.pings = 1;
    this.log('machine', 'ID ping sent', `${c.spec.label}: ${full.reply === 'friendly' ? 'correct reply' : full.reply === 'spoof' ? 'replied with an unregistered ID' : 'no reply yet'}`);
    return c;
  }

  spawn(e: P.CommandEvents['spawn']): ContactSim | null {
    const s = this.settings;
    const at = e.at ? this.cellAt(e.at) : null;
    const gate = this.h.spawns[0].cell;
    switch (e.preset) {
      case 'driven':
        return this.spawnContact({ mode: 'driven', startCell: at ?? gate, sizeM: s.sim.driveSizeM, speedMps: s.sim.driveSpeedMps, heat: 'hot', reply: 'none', erratic: false });
      case 'bot': {
        const goal = this.h.targets[Math.floor(this.rand() * this.h.targets.length)];
        const start = this.h.spawns[Math.floor(this.rand() * this.h.spawns.length)].cell;
        return this.spawnContact({ mode: 'bot', startCell: at ?? start, sizeM: 1 + this.rand() * 3, speedMps: 1.2 + this.rand() * 1.5, heat: 'hot', reply: 'none', plan: [{ goal: goal.id, sloppy: 0.4 }] });
      }
      case 'pair': {
        if (!this.night) this.simMin = Math.floor(this.simMin / 1440) * 1440 + 2 * 60;
        const a = this.spawnContact({ mode: 'bot', startCell: this.h.spawns[0].cell, sizeM: 1.2, speedMps: 1.6, heat: 'hot', reply: 'none', plan: [{ goal: 'fuel', sloppy: 0.2 }] });
        this.spawnContact({ mode: 'bot', startCell: this.h.spawns[1].cell, sizeM: 1.2, speedMps: 1.6, heat: 'hot', reply: 'none', plan: [{ goal: 'islands', sloppy: 0.2 }] });
        this.log('officer', 'Scenario playback', 'Two small unknowns from both gates at night. Simulated.');
        return a;
      }
      case 'scenario': {
        const inc = INCIDENTS.find((i) => i.key === e.scenarioKey);
        if (!inc) return null;
        if (inc.night && !this.night) { this.simMin = Math.floor(this.simMin / 1440) * 1440 + 2 * 60; }
        if (!inc.night && this.night) { this.simMin = Math.floor(this.simMin / 1440) * 1440 + 10 * 60; }
        const sc = s.scenarios.current;
        const len = Math.hypot(sc.gridDirection[0], sc.gridDirection[1]) || 1;
        const override = { currentU: sc.speedMps * sc.gridDirection[0] / len, currentV: -sc.speedMps * sc.gridDirection[1] / len };
        const c = this.spawnContact({
          mode: 'scenario', scenarioKey: inc.key, startCell: this.cellAt([inc.lon, inc.lat]), sizeM: inc.size, speedMps: inc.speed, heat: inc.heat,
          reply: inc.reply, registryId: inc.reply === 'registeredSilent' ? 'ALTASEA-G3' : null, plan: inc.plan, seed: inc.seed, currentOverride: override,
        });
        this.log('officer', 'Scenario playback', `Incident ${inc.key}: ${inc.name}. Simulated.`);
        return c;
      }
      case 'glider': {
        const dir = this.current ? [this.current.currentU, -this.current.currentV] as [number, number] : [0.6, 0.8] as [number, number];
        const speed = Math.max(0.1, this.currentSpeedMps || 0.2);
        return this.spawnContact({ mode: 'drift', startCell: at ?? this.cellAt([-118.266, 33.723]), sizeM: 1.8, speedMps: speed, heat: 'ambient', reply: 'registeredSilent', registryId: 'ALTASEA-G3', driftDir: dir });
      }
      case 'friendly':
        return this.spawnContact({ mode: 'bot', startCell: at ?? this.cellAt([-118.2470, 33.7215]), sizeM: 1.2, speedMps: 0.6, heat: 'hot', reply: 'friendly', registryId: 'HULLBOT-1', planFiled: true, plan: [{ goal: 'pier400', sloppy: 0.6 }] });
      case 'whale':
        return this.spawnContact({ mode: 'wander', startCell: at ?? this.cellAt([-118.236, 33.716]), sizeM: 18, speedMps: 1.5, heat: 'warm', reply: 'none', erratic: true }, false);
      case 'diver':
        return this.spawnContact({ mode: 'wander', startCell: at ?? this.cellAt([-118.2765, 33.7420]), sizeM: 2, speedMps: 0.4, heat: 'warm', reply: 'none' }, false);
    }
    return null;
  }

  private coordinatedCount(c: ContactSim): number {
    let n = 0;
    for (const o of this.contacts.values()) {
      if (o === c || !o.classification.threatScored || o.spec.reply === 'friendly' || o.classification.kind === 'debris') continue;
      const top = topGoal(o.tell);
      if (top.goal >= 0 && top.p >= this.settings.risk.urgentMinOdds) n++;
    }
    return n;
  }

  private evaluate(c: ContactSim): void {
    if (c.history.length === 0 || c.history[c.history.length - 1].t < this.simMin) recordOdds(c, this.simMin);
    evaluateContact(this.h, this.settings, c, {
      t: this.simMin, night: this.night, current: this.current, currentSpeedMps: this.currentSpeedMps,
      cruiseDocked: this.cruiseDocked, coordinatedCount: this.coordinatedCount(c),
    });
  }

  placeNear(cell: number): string {
    const [x, y] = this.h.grid.xy(cell);
    let best = 'the harbor', bd = Infinity;
    const named = [...this.h.targets.map((t) => ({ name: t.short ?? t.name, cell: t.cell })), ...this.h.gates.map((g) => ({ name: g.name, cell: g.cell })), ...this.h.places.map((p) => ({ name: p.name, cell: p.cell }))];
    for (const p of named) { const [px, py] = this.h.grid.xy(p.cell); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = p.name; } }
    return withArticle(best);
  }

  tick(dtRealMs: number, wallMs: number): void {
    this.wallMs = wallMs;
    if (this.paused) return;
    const dtSec = (dtRealMs / 1000) * this.timeScale;
    this.simMin += dtSec / 60;
    const t = this.simMin;
    for (const c of this.contacts.values()) {
      let stepped = false;
      moveContact(this.h, this.settings, c, dtSec, t, { t, night: this.night, current: this.current, currentSpeedMps: this.currentSpeedMps, cruiseDocked: this.cruiseDocked, coordinatedCount: 0 }, () => { stepped = true; this.evaluate(c); });
      if (!stepped && t - c.lastEvalMin >= 0.25) this.evaluate(c);
      if (c.pings < 2 && t - c.spec.firstSeenMin >= 1 && c.spec.reply !== 'friendly') { c.pings = 2; this.log('machine', 'ID ping sent', `${c.spec.label}: second ping, no reply`); }
      const last = this.lastResponseMin.get(c.id) ?? -Infinity;
      if (stepped || t - last >= 0.5) { this.lastResponseMin.set(c.id, t); this.respondTo(c); }
    }
    for (const craft of this.craft) moveCraft(this.h, craft, dtSec, t, null);
    this.updateNotices();
    this.updateCards();
    this.allClearRecent = this.allClearRecent.filter((a) => t - a.atMin < 3);
  }

  private boats(): Boat[] {
    return this.craft.map((c) => ({ id: c.id, name: c.name, route: remainingRoute(c), speedMps: c.speedMps, smallCraft: c.smallCraft }));
  }

  private responseRules(level: number, routine: boolean): Parameters<typeof chooseResponse>[4] {
    const o = this.orders();
    const pr = this.settings.priority;
    const cell = this.h.grid.cellMeters;
    return {
      maxDelayPerBoatMin: o.maxDelayPerBoatMin,
      speedAdvisoryKnots: o.speedAdvisoryKnots,
      speedAdvisoryMaxDelayMin: o.speedAdvisoryMaxDelayMin,
      advisoryMarginCells: 250 / cell,
      p1Minutes: pr.p1Minutes,
      p2Minutes: pr.p2Minutes,
      floor: level >= CRITICAL ? (pr.criticalFloor as Priority) : null,
      ceiling: routine ? (pr.routineCeiling as Priority) : null,
      nearbyCells: 1500 / cell,
      channelNearCells: 400 / cell,
    };
  }

  private respondTo(c: ContactSim): void {
    const kind = c.classification.kind;
    if (kind === 'animal') return this.respondToAnimal(c);
    if (kind === 'person') return this.respondToPerson(c);
    if (c.spec.registryId && kind === 'debris') this.respondToLostRobot(c);
    const risk = c.lastRisk;
    const zoneId = `z-${c.id}`;
    const existing = this.zones.get(zoneId);
    if (!risk || risk.level < SERIOUS || c.spec.reply === 'friendly') {
      if (existing && existing.status === 'draft') { this.zones.delete(zoneId); this.dropDraftFor(zoneId); }
      return;
    }
    const o = this.orders();
    const top = topGoal(c.tell);
    const unsure = top.goal < 0 || top.p < o.unsureBelowOdds;
    const silentFor = c.silent && c.silentSinceMin !== null ? this.simMin - c.silentSinceMin : 0;
    const geom = securityZone(this.h.grid, {
      contactCell: c.cell, predictedPaths: predictedPaths(this.h, c, o.zoneTopTargets), speedMps: c.spec.speedMps,
      zoneMeters: o.zoneMeters, pathMinutes: o.zonePathMinutes, unsure, growWhenUnsure: o.zoneGrowWhenUnsure,
      silentMinutes: silentFor, topSpeedMps: c.spec.speedMps,
    });
    const draft = existing?.draftId ? this.drafts.get(existing.draftId) : undefined;
    const radiusM = draft?.officerRadius ?? geom.radiusM;
    const g2 = draft?.officerRadius ? securityZone(this.h.grid, {
      contactCell: c.cell, predictedPaths: predictedPaths(this.h, c, o.zoneTopTargets), speedMps: c.spec.speedMps,
      zoneMeters: draft.officerRadius, pathMinutes: o.zonePathMinutes, unsure: false, growWhenUnsure: 1, silentMinutes: silentFor, topSpeedMps: c.spec.speedMps,
    }) : geom;
    const zone: ZoneRec = existing ?? {
      id: zoneId, kind: 'keepOut', reason: 'Security zone', status: 'draft', geometry: g2, radiusM, contactId: c.id, noticeId: null, draftId: null,
      movingTowardDeg: c.headingDeg, movingSpeedMps: c.spec.speedMps, centerCell: c.cell,
    };
    zone.geometry = g2;
    zone.radiusM = radiusM;
    zone.movingTowardDeg = c.headingDeg;
    zone.movingSpeedMps = c.silent ? 0 : c.spec.speedMps;
    zone.centerCell = c.cell;
    this.zones.set(zoneId, zone);
    const targetName = top.goal >= 0 ? (this.h.targets[top.goal].short ?? this.h.targets[top.goal].name) : null;
    const plan = chooseResponse(this.h.grid, g2.mask, this.boats(), this.h.places.map((p) => ({ id: p.id, name: p.name, cell: p.cell })), this.responseRules(risk.level, false), targetName);
    if (zone.status === 'published' && zone.noticeId) {
      const n = this.notices.get(zone.noticeId);
      if (n) { n.responsePlan = plan; n.plan = this.planView(plan, n.radiusM, n.slowKnots); }
    } else {
      const meetsOrders = risk.R >= o.draftRiskMin && top.goal >= 0 && top.p >= o.draftOddsMin && plan.withinOrders && plan.kind !== 'watch';
      if (meetsOrders || zone.draftId) this.upsertSecurityDraft(c, zone, plan, risk.level);
    }
    if (risk.level < HIGH || top.goal < 0) this.removeCards((k) => k.key.startsWith(`hold:${c.id}:`));
    if (risk.level >= HIGH && top.goal >= 0) {
      const tgt = this.h.targets[top.goal];
      this.removeCards((k) => k.key.startsWith(`hold:${c.id}:`) && k.key !== `hold:${c.id}:${tgt.id}`);
      this.raiseCard(`hold:${c.id}:${tgt.id}`, {
        kind: 'hold', title: `Hold ${tgt.short ?? tgt.name}?`,
        body: `${c.spec.label} is rated ${risk.levelName} (${risk.R}). Hold this one berth until it is identified. Ships due there wait; nothing else closes.`,
        facts: [`${tgt.short ?? tgt.name}: ${Math.round(top.p * 100)}%`, `ETA ${minutesLabel(etaToGoal(this.h, c, top.goal))}`, `Rerouting alone: ${plan.comparison.chosen}`],
        actions: [{ id: 'approve', label: `Hold ${tgt.short ?? tgt.name}`, primary: true }, { id: 'notNow', label: 'Not now' }],
        contactId: c.id, noticeId: null, draftId: null, script: null,
      });
    }
    if (risk.level >= CRITICAL) {
      const facts = this.wordingFacts(c, zone, plan, this.drafts.get(zone.draftId ?? '') ?? null);
      this.raiseCard(`handoff:${c.id}`, {
        kind: 'handoff', title: 'Send the Coast Guard brief?',
        body: `${c.spec.label} is Critical (${risk.R}) and within 30 minutes of ${targetName ?? 'a target'}. The brief is drafted. Nothing has touched the vehicle.`,
        facts: [`Target ${targetName ?? 'unknown'}`, `ETA ${minutesLabel(top.goal >= 0 ? etaToGoal(this.h, c, top.goal) : null)}`, `Hostility ${c.hostility?.H.toFixed(2) ?? 'n/a'}`],
        actions: [{ id: 'send', label: 'Approve and send', primary: true }, { id: 'notNow', label: 'Not now' }],
        contactId: c.id, noticeId: null, draftId: null, script: templateWording(facts).brief,
      });
    }
    if (this.coordinatedCount(c) >= 1 && risk.level >= SERIOUS) {
      this.raiseCard('handoff:coordinated', {
        kind: 'handoff', title: 'Coordinated contacts: hand off?',
        body: 'Two or more unknown contacts are heading for targets at the same time. Hand this to the Coast Guard and port police.',
        facts: [...this.contacts.values()].filter((o2) => o2.lastRisk && o2.lastRisk.level >= SERIOUS).map((o2) => `${o2.spec.label}: ${o2.lastRisk?.levelName}`),
        actions: [{ id: 'send', label: 'Approve and send', primary: true }, { id: 'notNow', label: 'Not now' }],
        contactId: c.id, noticeId: null, draftId: null, script: null,
      });
    }
  }

  private respondToLostRobot(c: ContactSim): void {
    const reg = this.h.registry.find((r) => r.id === c.spec.registryId);
    if (!reg) return;
    const home = this.h.targets.find((t) => t.id === reg.homeTarget);
    const key = `lost:${c.id}`;
    if (!this.cards.some((k) => k.key === key) && !this.dismissed.has(key)) {
      this.log('machine', 'Owner notified', `${reg.owner}: ${reg.name} is silent and drifting. Search area sent.`);
    }
    this.raiseCard(key, {
      kind: 'lost', title: 'Lost, not hostile',
      body: `${reg.name} stopped reporting. It is drifting with the current, not aiming. It was heading back to its dock at the ${home?.short ?? 'home berth'}.`,
      facts: [`Owner: ${reg.owner} (notified)`, `Drift ${mpsToKnots(c.spec.speedMps).toFixed(1)} kn toward ${compassPoint(c.headingDeg)}`, 'Keep-clear zone drafted for boats'],
      actions: [{ id: 'publishZone', label: 'Publish keep-clear zone', primary: true }, { id: 'ok', label: 'OK' }],
      contactId: c.id, noticeId: null, draftId: null, script: null,
    });
    const zoneId = `z-${c.id}`;
    const radius = 150 + c.spec.speedMps * (this.simMin - c.spec.firstSeenMin) * 60 * 0.5;
    this.upsertRoutineZone(zoneId, 'keepOut', 'Dredge working', c.cell, Math.min(600, radius), c.id, 'KEEP CLEAR', 'Search area: lost research robot');
  }

  private respondToAnimal(c: ContactSim): void {
    const key = `animal:${c.id}`;
    if (!this.marineLog.some((m) => m.id === key)) {
      this.marineLog.push({ id: key, atMin: this.simMin, lonlat: contactLonLat(this.h, c), kind: 'Marine animal', detail: `${c.spec.sizeM.toFixed(0)} m, warm, erratic, surfacing near ${this.placeNear(c.cell)}` });
      this.log('machine', 'Marine-life log', `Animal logged near ${this.placeNear(c.cell)}`);
    }
    const o = this.orders();
    const draftId = this.upsertRoutineZone(`z-${c.id}`, 'slow', 'Whale nearby', c.cell, o.animalSlowMeters, c.id, 'SLOW', null);
    this.raiseCard(key, {
      kind: 'animal', title: 'Whale slow zone?',
      body: `A marine animal is surfacing near ${this.placeNear(c.cell)}. Boats within ${o.animalSlowMeters} m slow to ${o.animalSlowKnots} knots. It is never scored as a threat.`,
      facts: ['Marine-life log entry made', 'Uses the routine template you signed'],
      actions: [{ id: 'publish', label: 'Publish slow zone', primary: true }, { id: 'ok', label: 'Not now' }],
      contactId: c.id, noticeId: null, draftId, script: null,
    });
  }

  private respondToPerson(c: ContactSim): void {
    const key = `person:${c.id}`;
    const draftId = this.upsertRoutineZone(`z-${c.id}`, 'keepOut', 'Person in the water', c.cell, 200, c.id, 'KEEP CLEAR', null);
    this.raiseCard(key, {
      kind: 'person', title: 'Person in the water: hand off',
      body: `A warm body about ${c.spec.sizeM.toFixed(1)} m moving slowly near ${this.placeNear(c.cell)}. Boats are routed away. Port police brief is ready. People are never scored as targets.`,
      facts: [`Near ${this.placeNear(c.cell)}`, `${c.spec.speedMps.toFixed(1)} m/s`],
      actions: [{ id: 'send', label: 'Send port police brief', primary: true }, { id: 'publish', label: 'Publish keep-clear zone' }],
      contactId: c.id, noticeId: null, draftId, script: `Port police, this is ${this.station}. Possible person in the water near ${this.placeNear(c.cell)}. Boats are being routed away. Request a unit to check.`,
    });
  }

  private upsertRoutineZone(zoneId: string, kind: 'keepOut' | 'slow', reason: P.PublicReason, cell: number, radiusM: number, contactId: string | null, instruction: Instruction, label: string | null): string | null {
    const existing = this.zones.get(zoneId);
    if (existing?.status === 'published') {
      existing.geometry = circleZone(this.h.grid, cell, existing.radiusM);
      existing.centerCell = cell;
      return existing.draftId;
    }
    const draft = existing?.draftId ? this.drafts.get(existing.draftId) : undefined;
    const r = draft?.officerRadius ?? radiusM;
    const geometry = circleZone(this.h.grid, cell, r);
    const zone: ZoneRec = existing ?? { id: zoneId, kind, reason, status: 'draft', geometry, radiusM: r, contactId, noticeId: null, draftId: null, movingTowardDeg: null, movingSpeedMps: 0, centerCell: cell };
    zone.geometry = geometry;
    zone.radiusM = r;
    zone.centerCell = cell;
    this.zones.set(zoneId, zone);
    const plan = kind === 'slow' ? this.slowPlan(geometry.mask, cell, r) : chooseResponse(this.h.grid, geometry.mask, this.boats(), this.h.places.map((p) => ({ id: p.id, name: p.name, cell: p.cell })), this.responseRules(0, true), null);
    const noticeKind: P.NoticeKind = reason === 'Whale nearby' ? 'whale' : reason === 'Divers in water' ? 'divers' : reason === 'Person in the water' ? 'person' : 'dredge';
    return this.upsertDraft(zone, plan, noticeKind, instruction, true, null, label);
  }

  private slowPlan(mask: Uint8Array, centerCell: number | null = null, radiusM = 0): ResponsePlan {
    const o = this.orders();
    const pr = this.settings.priority;
    const slowMps = o.animalSlowKnots * 0.514444;
    const core = centerCell !== null && radiusM > 0 ? circleZone(this.h.grid, centerCell, radiusM * o.animalCoreFraction).mask : null;
    const everyone = this.boats().map((b) => {
      const onRoute = routeEntersMask(b.route, mask);
      const minutesToZone = onRoute ? minutesUntilZone(this.h.grid, b.route, mask, b.speedMps) : null;
      let addedMin = 0;
      let reroute: ReturnType<typeof rerouteAround> | null = null;
      if (onRoute && core && routeEntersMask(b.route, core)) {
        const r = rerouteAround(this.h.grid, b.route, core, b.speedMps);
        if ((r.status === 'rerouted' || r.status === 'leaveZone') && r.addedMin <= o.animalMaxBendMin) { reroute = r; addedMin += r.addedMin; }
      }
      const path = reroute ? reroute.cells : b.route;
      if (onRoute && b.speedMps > slowMps) {
        const inside = path.filter((cell) => mask[cell]).length * this.h.grid.cellMeters;
        addedMin += (inside / slowMps - inside / b.speedMps) / 60;
      }
      return {
        id: b.id, name: b.name, onRoute, nearPath: false, insideNow: mask[b.route[0]] === 1, minutesToZone,
        priority: priorityFor(minutesToZone, { p1Minutes: pr.p1Minutes, p2Minutes: pr.p2Minutes, ceiling: pr.routineCeiling as Priority }),
        action: reroute ? 'reroute' as const : onRoute ? 'slow' as const : 'none' as const, instruction: 'SLOW' as Instruction, addedMin, reroute,
      };
    });
    const affected = everyone.filter((e) => e.onRoute);
    const total = affected.reduce((s, e) => s + e.addedMin, 0);
    return {
      kind: 'speedAdvisory', affected, everyone, totalAddedMin: total, maxAddedMin: Math.max(0, ...affected.map((e) => e.addedMin)),
      clears: true, withinOrders: true, blockedBerth: null, reasons: [`${affected.length} boat routes pass through the slow zone.`],
      nextStepUp: { kind: 'reroute', text: 'Reroute boats around the animal' },
      comparison: { chosen: `Slowing: ${affected.length} boats, +${Math.round(total)} min total`, closeHarbor: 'Closing the harbor: every ship delayed' },
    };
  }

  private planView(plan: ResponsePlan, radiusM = 250, slowKnots = this.orders().speedAdvisoryKnots): P.PlanView {
    const craftById = new Map(this.craft.map((c) => [c.id, c]));
    return {
      kind: plan.kind,
      boats: plan.affected.map((a) => ({
        vesselId: a.id, name: a.name, priority: a.priority, instruction: instructionText(a.instruction, radiusM, slowKnots),
        addedMin: a.addedMin, action: a.action, minutesToZone: a.minutesToZone, simulated: !craftById.get(a.id)?.phone,
      })),
      totalAddedMin: plan.totalAddedMin, maxAddedMin: plan.maxAddedMin, clears: plan.clears, withinOrders: plan.withinOrders,
      reasons: plan.reasons, nextStepUp: plan.nextStepUp.text, comparison: plan.comparison,
    };
  }

  private upsertSecurityDraft(c: ContactSim, zone: ZoneRec, plan: ResponsePlan, level: number): void {
    const draftId = this.upsertDraft(zone, plan, 'security', 'KEEP CLEAR', false, c, null);
    if (!draftId) return;
    const d = this.drafts.get(draftId);
    if (!d) return;
    this.raiseCard(`publish:${draftId}`, {
      kind: 'publish', title: 'Give-way notice drafted',
      body: d.wording.why,
      facts: [plan.comparison.chosen, plan.comparison.closeHarbor, `Risk ${c.lastRisk?.R ?? ''} ${levelName(level)}`],
      actions: [{ id: 'publish', label: 'Publish', primary: true }, { id: 'discard', label: 'Discard' }],
      contactId: c.id, noticeId: null, draftId, script: null,
    });
  }

  private upsertDraft(zone: ZoneRec, plan: ResponsePlan, kind: P.NoticeKind, instruction: Instruction, routine: boolean, c: ContactSim | null, label: string | null): string | null {
    const o = this.orders();
    let d = zone.draftId ? this.drafts.get(zone.draftId) : undefined;
    const slowKnots = kind === 'whale' ? o.animalSlowKnots : o.speedAdvisoryKnots;
    if (!d) {
      const id = this.id('d');
      d = {
        id, kind, contactId: c?.id ?? zone.contactId, zoneId: zone.id, instruction, instructionText: '', radiusM: zone.radiusM, slowKnots,
        recipients: 'all', named: [], publicReason: zone.reason, validForMin: routine ? 120 : 60, approvedBy: this.officer,
        plan: this.planView(plan, zone.radiusM, slowKnots), wording: templateWording(this.blankFacts(zone)), createdAtMin: this.simMin, updatedAtMin: this.simMin,
        edited: false, routine, responsePlan: plan, wordingKey: '', factsKey: '', wordingInFlight: false, officerRadius: null, officerInstruction: null,
      };
      this.drafts.set(id, d);
      zone.draftId = id;
      const draftRef = d;
      this.log('machine', 'Notice drafted', `${label ?? (kind === 'security' ? 'Give-way notice' : `${zone.reason} zone`)} near ${this.placeNear(zone.centerCell)}: ${plan.comparison.chosen}`, () => this.discardDraft(draftRef.id, 'machine'));
    }
    d.instruction = d.officerInstruction ?? instruction;
    d.radiusM = zone.radiusM;
    d.slowKnots = slowKnots;
    d.instructionText = instructionText(d.instruction as Instruction, d.radiusM, d.slowKnots);
    d.responsePlan = plan;
    d.plan = this.planView(plan, d.radiusM, d.slowKnots);
    d.updatedAtMin = this.simMin;
    d.approvedBy = this.officer;
    const facts = this.wordingFacts(c, zone, plan, d);
    const template = templateWording(facts);
    const key = [d.instructionText, d.publicReason, plan.affected.length, Math.round(plan.totalAddedMin), facts.contact?.targetName ?? '', facts.contact?.level ?? '', d.recipients].join('|');
    d.factsKey = key;
    if (d.wording.source === 'template' || key !== d.wordingKey) d.wording = template;
    if (key !== d.wordingKey && !d.wordingInFlight) {
      d.wordingKey = key;
      d.wordingInFlight = true;
      this.effects.wording.push({ draftId: d.id, facts, template, key });
    }
    return d.id;
  }

  applyWording(draftId: string, wording: P.Wording, key?: string): void {
    const d = this.drafts.get(draftId) ?? this.notices.get(draftId);
    if (!d) return;
    if ('wordingInFlight' in d) {
      const draft = d as DraftRec;
      draft.wordingInFlight = false;
      if (key !== undefined && key !== draft.factsKey) { draft.wordingKey = ''; return; }
    }
    d.wording = wording;
    const card = this.cards.find((k) => k.draftId === draftId && k.kind === 'publish');
    if (card) card.body = wording.why;
    if (wording.source === 'granite') this.log('machine', 'Wording by Granite', `${d.publicReason}: notice, radio script and translations written from the facts. Nothing decided.`);
  }

  private blankFacts(zone: ZoneRec): WordingFacts {
    return {
      kind: 'security', instruction: 'KEEP CLEAR', instructionText: instructionText('KEEP CLEAR', zone.radiusM, 5), publicReason: zone.reason, radiusM: zone.radiusM,
      slowKnots: 5, nearPlace: this.placeNear(zone.centerCell), validUntilMin: this.simMin + 60, approvedBy: this.officer, boats: [], totalAddedMin: 0,
      station: this.station, link: this.link,
    };
  }

  private wordingFacts(c: ContactSim | null, zone: ZoneRec, plan: ResponsePlan, d: DraftRec | null): WordingFacts {
    const instruction = d?.instruction ?? 'KEEP CLEAR';
    const radiusM = d?.radiusM ?? zone.radiusM;
    const slowKnots = d?.slowKnots ?? this.orders().speedAdvisoryKnots;
    const facts: WordingFacts = {
      kind: d?.kind ?? 'security', instruction, instructionText: instructionText(instruction as Instruction, radiusM, slowKnots), publicReason: d?.publicReason ?? zone.reason,
      radiusM, slowKnots, nearPlace: this.placeNear(zone.centerCell), validUntilMin: this.simMin + (d?.validForMin ?? 60), approvedBy: this.officer,
      boats: plan.affected.map((a) => ({ name: a.name, instructionText: instructionText(a.instruction, radiusM, slowKnots), addedMin: a.addedMin })),
      totalAddedMin: plan.totalAddedMin, station: this.station, link: this.link,
    };
    if (c && c.lastRisk && c.hostility) {
      const top = topGoal(c.tell);
      const tgt = top.goal >= 0 ? this.h.targets[top.goal] : null;
      const ll = contactLonLat(this.h, c);
      facts.contact = {
        label: c.spec.label, classification: c.classification.label, sizeM: c.spec.sizeM, speedMps: c.spec.speedMps, hostility: c.hostility.H,
        evidence: c.hostility.items.filter((i) => i.key !== 'start').map((i) => i.label.toLowerCase()),
        targetName: tgt?.short ?? tgt?.name ?? 'no clear target', odds: top.p, etaMin: top.goal >= 0 ? etaToGoal(this.h, c, top.goal) : null,
        riskScore: c.lastRisk.R, level: c.lastRisk.levelName, damage: damagePhrase(tgt?.kind ?? ''),
        lonlatText: `${Math.abs(ll[1]).toFixed(4)} N ${Math.abs(ll[0]).toFixed(4)} W`,
      };
    }
    return facts;
  }

  private dropDraftFor(zoneId: string): void {
    for (const d of this.drafts.values()) if (d.zoneId === zoneId) { this.drafts.delete(d.id); this.removeCards((k) => k.draftId === d.id); }
  }

  discardDraft(draftId: string, actor = 'officer'): void {
    const d = this.drafts.get(draftId);
    if (!d) return;
    this.drafts.delete(draftId);
    const z = this.zones.get(d.zoneId);
    if (z && z.status === 'draft') { this.zones.delete(z.id); this.dismissed.add(`zone:${z.id}`); }
    this.removeCards((k) => k.draftId === draftId);
    this.log(actor, 'Draft discarded', `${d.publicReason} near ${z ? this.placeNear(z.centerCell) : 'the harbor'}`);
  }

  editDraft(e: P.CommandEvents['editDraft']): void {
    const d = this.drafts.get(e.draftId);
    if (!d) return;
    const ed = e.edits;
    if (ed.radiusM !== undefined) d.officerRadius = Math.max(50, Math.min(3000, ed.radiusM));
    if (ed.instruction !== undefined) d.officerInstruction = ed.instruction;
    if (ed.recipients !== undefined) d.recipients = ed.recipients;
    if (ed.named !== undefined) d.named = ed.named;
    if (ed.publicReason !== undefined) d.publicReason = ed.publicReason;
    if (ed.validForMin !== undefined) d.validForMin = ed.validForMin;
    if (ed.slowKnots !== undefined) d.slowKnots = ed.slowKnots;
    d.edited = true;
    const z = this.zones.get(d.zoneId);
    if (z) {
      if (ed.publicReason) z.reason = ed.publicReason;
      if (d.officerRadius !== null && !z.contactId) {
        z.radiusM = d.officerRadius;
        z.geometry = circleZone(this.h.grid, z.centerCell, z.radiusM);
      }
      const c = z.contactId ? this.contacts.get(z.contactId) : undefined;
      if (c && c.classification.threatScored && c.classification.kind !== 'debris') this.respondTo(c);
      else if (z.status === 'draft') {
        const plan = z.kind === 'slow' ? this.slowPlan(z.geometry.mask, z.centerCell, z.radiusM) : chooseResponse(this.h.grid, z.geometry.mask, this.boats(), this.h.places.map((p) => ({ id: p.id, name: p.name, cell: p.cell })), this.responseRules(0, true), null);
        this.upsertDraft(z, plan, d.kind, (d.officerInstruction ?? d.instruction) as Instruction, d.routine, null, null);
      }
    }
    this.log('officer', 'Draft edited', Object.entries(ed).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join('; '));
  }

  dropZone(e: P.CommandEvents['dropZone']): string | null {
    const cell = this.cellAt(e.lonlat);
    const o = this.orders();
    const zoneId = this.id('z');
    if (e.kind === 'whale') {
      const draftId = this.upsertRoutineZone(zoneId, 'slow', 'Whale nearby', cell, e.radiusM ?? o.animalSlowMeters, null, 'SLOW', 'Whale slow zone');
      this.marineLog.push({ id: this.id('m'), atMin: this.simMin, lonlat: this.lonlatOf(cell), kind: 'Whale sighting', detail: `Reported by the officer near ${this.placeNear(cell)}` });
      this.attachUndoToLast(() => this.removeZone(zoneId));
      return draftId;
    }
    const reason: P.PublicReason = e.kind === 'divers' ? 'Divers in water' : 'Dredge working';
    const draftId = this.upsertRoutineZone(zoneId, 'keepOut', reason, cell, e.radiusM ?? o.routineZoneMeters, null, 'KEEP CLEAR', `${reason} zone`);
    this.attachUndoToLast(() => this.removeZone(zoneId));
    return draftId;
  }

  private attachUndoToLast(fn: () => void): void {
    const last = this.audit[this.audit.length - 1];
    if (!last) return;
    last.undoable = true;
    this.undoers.set(last.id, fn);
  }

  private removeZone(zoneId: string): void {
    const z = this.zones.get(zoneId);
    if (!z) return;
    if (z.noticeId) this.clearNotice(z.noticeId, 'officer', false);
    if (z.draftId) { this.drafts.delete(z.draftId); this.removeCards((k) => k.draftId === z.draftId); }
    this.zones.delete(zoneId);
  }

  publish(draftId: string): string | null {
    const d = this.drafts.get(draftId);
    if (!d) return null;
    const z = this.zones.get(d.zoneId);
    if (!z) return null;
    const plan = d.responsePlan;
    const id = this.id('n');
    const notice: NoticeRec = {
      ...d, id, publishedAtMin: this.simMin, publishedAtWall: this.wall(), expiresAtMin: this.simMin + d.validForMin, status: 'active',
      approvedBy: this.officer, perVessel: new Map(), responsePlan: plan,
    };
    delete (notice as Partial<DraftRec>).wordingKey;
    this.notices.set(id, notice);
    this.drafts.delete(draftId);
    this.removeCards((k) => k.draftId === draftId);
    z.status = 'published';
    z.noticeId = id;
    z.draftId = null;
    this.refreshNotice(notice);
    this.log('officer', 'Published', `${d.publicReason}: ${d.instructionText}. ${notice.perVessel.size} recipients. ${plan?.comparison.chosen ?? ''}`, () => this.clearNotice(id, 'officer', true));
    if (notice.wording.source === 'template') this.effects.wording.push({ draftId: id, facts: this.wordingFacts(z.contactId ? this.contacts.get(z.contactId) ?? null : null, z, plan ?? this.slowPlan(z.geometry.mask), null), template: notice.wording, key: 'notice' });
    return id;
  }

  private recipientsFor(n: NoticeRec): { id: string; name: string; simulated: boolean; channel: P.Channel; craft: CraftSim | null; ais: (AisInputVessel & { cell: number }) | null }[] {
    const list: ReturnType<World['recipientsFor']> = [];
    for (const c of this.craft) {
      if (n.recipients === 'named' && !n.named.includes(c.id) && !n.named.includes(c.name)) continue;
      const joined = this.captains.get(c.id)?.connected ?? false;
      list.push({ id: c.id, name: c.name, simulated: !c.phone || !joined, channel: 'app', craft: c, ais: null });
    }
    for (const v of this.ais) {
      if (v.cell < 0) continue;
      if (n.recipients === 'small' && v.aisClass === 'A' && (v.lengthM ?? 0) > 40) continue;
      if (n.recipients === 'named' && !n.named.includes(v.name)) continue;
      list.push({ id: `ais-${v.mmsi}`, name: v.name || `MMSI ${v.mmsi}`, simulated: false, channel: v.aisClass === 'A' ? 'ais' : 'vhf', craft: null, ais: v });
    }
    return list;
  }

  private aisProjectedRoute(v: AisInputVessel & { cell: number }): number[] {
    if (v.sogKn < 0.5) return [v.cell];
    const ahead = offsetPoint([v.lon, v.lat], v.sogKn * 0.514444 * 20 * 60, v.cogDeg);
    const end = this.cellAt(ahead);
    return [v.cell, ...walkLine(this.h.grid, v.cell, end)];
  }

  private refreshNotice(n: NoticeRec): void {
    const z = this.zones.get(n.zoneId);
    if (!z) return;
    const mask = z.geometry.mask;
    const plan = n.responsePlan;
    const pr = this.settings.priority;
    const routine = n.routine;
    const level = z.contactId ? this.contacts.get(z.contactId)?.lastRisk?.level ?? 0 : 0;
    const byId = new Map((plan?.everyone ?? []).map((e) => [e.id, e]));
    for (const r of this.recipientsFor(n)) {
      let entry: VesselPlanEntry;
      if (r.craft) {
        const e = byId.get(r.id);
        const route = remainingRoute(r.craft);
        const minutesToZone = minutesUntilZone(this.h.grid, route, mask, r.craft.speedMps);
        let priority = priorityFor(minutesToZone, { p1Minutes: pr.p1Minutes, p2Minutes: pr.p2Minutes, floor: level >= CRITICAL ? pr.criticalFloor as Priority : null, nearby: !!e?.onRoute, ceiling: routine ? pr.routineCeiling as Priority : null });
        const prev = n.perVessel.get(r.id);
        if (prev && r.craft.rerouteNoticeId === n.id) priority = lessUrgent(prev.priority, prev.priority);
        const instruction: Instruction = e && e.action !== 'none' ? e.instruction : (n.instruction as Instruction);
        entry = {
          priority: prev && r.craft.rerouteNoticeId === n.id ? prev.priority : priority, instruction,
          instructionText: instructionText(instruction, n.radiusM, n.slowKnots), addedMin: e?.addedMin ?? 0, minutesToZone,
          action: e?.action ?? 'none', newRoute: e?.reroute && e.reroute.status !== 'clear' ? e.reroute.cells : null,
        };
      } else {
        const v = r.ais!;
        const route = this.aisProjectedRoute(v);
        const minutesToZone = minutesUntilZone(this.h.grid, route, mask, Math.max(0.3, v.sogKn * 0.514444));
        const priority = priorityFor(minutesToZone, { p1Minutes: pr.p1Minutes, p2Minutes: pr.p2Minutes, ceiling: routine ? pr.routineCeiling as Priority : null });
        entry = { priority, instruction: n.instruction as Instruction, instructionText: n.instructionText, addedMin: 0, minutesToZone, action: 'none', newRoute: null };
      }
      n.perVessel.set(r.id, entry);
      const key = `${n.id}:${r.id}`;
      if (!this.deliveries.has(key)) this.createDelivery(n, r, entry);
      else this.updateDeliveryPriority(this.deliveries.get(key)!, r.craft, entry);
    }
  }

  private updateDeliveryPriority(rec: DeliveryRec, craft: CraftSim | null, entry: VesselPlanEntry): void {
    rec.priority = entry.priority;
    const relevant = entry.priority === 'P1' || entry.priority === 'P2' || entry.action !== 'none';
    if (!craft || !rec.simulated || craft.ignoresNotices || !relevant || rec.states.acknowledged !== undefined || rec.plannedAck !== null) return;
    const t = this.simMin;
    rec.plannedDelivered ??= t + 0.05;
    rec.plannedSeen ??= Math.max(t, rec.plannedDelivered) + 0.1 + this.rand() * 0.4;
    rec.plannedAck = rec.plannedSeen + 0.2 + this.rand() * 0.6;
  }

  private createDelivery(n: NoticeRec, r: ReturnType<World['recipientsFor']>[number], entry: VesselPlanEntry): void {
    const t = this.simMin;
    const ds = this.settings.delivery;
    const isPhone = !!r.craft?.phone && (this.captains.get(r.id)?.connected ?? false);
    const ignores = !!r.craft?.ignoresNotices;
    const rec: DeliveryRec = {
      noticeId: n.id, vesselId: r.id, vesselName: r.name, simulated: r.simulated, channel: r.channel, priority: entry.priority,
      states: { sent: t }, resends: 0, notResponding: false, ackAtMin: null, vhfCalled: false,
      plannedDelivered: null, plannedSeen: null, plannedAck: null,
    };
    if (r.craft && !isPhone) {
      rec.plannedDelivered = t + 0.05 + this.rand() * 0.15;
      const relevant = entry.priority === 'P1' || entry.priority === 'P2' || entry.action !== 'none';
      if (!ignores) {
        if (relevant || this.rand() < ds.simulatedSeenRate) rec.plannedSeen = rec.plannedDelivered + 0.1 + this.rand() * 0.6;
        if (rec.plannedSeen !== null && (relevant || this.rand() < ds.simulatedAckRate / ds.simulatedSeenRate)) rec.plannedAck = rec.plannedSeen + 0.2 + this.rand() * 0.8;
      }
    }
    this.deliveries.set(`${n.id}:${r.id}`, rec);
    if (isPhone && (entry.priority === 'P1' || entry.priority === 'P2')) {
      this.effects.pushes.push({
        vesselId: r.id, priority: entry.priority, tag: n.id, url: `/captain?notice=${n.id}`,
        title: entry.priority === 'P1' ? `ACT NOW: ${entry.instructionText}` : `Act soon: ${entry.instructionText}`,
        body: `${n.publicReason} near ${this.placeNear(this.zones.get(n.zoneId)?.centerCell ?? 0)}. Tap for the map.`,
      });
    }
  }

  private updateNotices(): void {
    const t = this.simMin;
    const ds = this.settings.delivery;
    const channels = this.settings.channels;
    for (const n of this.notices.values()) {
      if (n.status !== 'active') continue;
      if (t >= n.expiresAtMin) { this.clearNotice(n.id, 'machine', false, 'Expired'); continue; }
      this.refreshNotice(n);
      const z = this.zones.get(n.zoneId);
      const mask = z?.geometry.mask ?? null;
      for (const [vid, entry] of n.perVessel) {
        const rec = this.deliveries.get(`${n.id}:${vid}`);
        if (!rec) continue;
        const craft = this.craft.find((c) => c.id === vid);
        if (rec.plannedDelivered !== null && t >= rec.plannedDelivered && rec.states.delivered === undefined) rec.states.delivered = rec.plannedDelivered;
        if (rec.plannedSeen !== null && t >= rec.plannedSeen && rec.states.seen === undefined) rec.states.seen = rec.plannedSeen;
        if (rec.plannedAck !== null && t >= rec.plannedAck && rec.states.acknowledged === undefined) { rec.states.acknowledged = rec.plannedAck; this.onAcknowledged(n, vid, entry, 'simulated'); }
        const inside = craft ? !!mask && mask[currentCell(craft)] === 1 : false;
        if (craft && rec.states.acknowledged !== undefined && rec.states.complying === undefined) {
          const avoiding = !inside && (!mask || !routeEntersMask(remainingRoute(craft), mask) || craft.held || entry.action === 'slow');
          if (avoiding) rec.states.complying = t;
        }
        if (!craft && rec.states.complying === undefined) {
          const v = this.ais.find((a) => `ais-${a.mmsi}` === vid);
          if (v && mask && mask[v.cell] !== 1 && entry.minutesToZone === null) rec.states.complying = t;
        }
        const relevant = entry.priority === 'P1' || entry.priority === 'P2';
        if (craft && relevant && rec.states.acknowledged === undefined) {
          const waited = t - (rec.states.sent ?? t);
          if (waited >= ds.resendMinutes && rec.resends === 0) {
            rec.resends = 1;
            const phone = craft.phone && (this.captains.get(vid)?.connected ?? false);
            if (phone) {
              this.effects.resends.push({ noticeId: n.id, vesselId: vid, vesselName: rec.vesselName, priority: entry.priority, text: `GIVE WAY ${entry.priority}: ${entry.instructionText}. ${n.publicReason}. ${this.link}` });
            } else {
              const next: P.Channel = channels.push ? 'push' : channels.sms ? 'sms' : 'vhf';
              rec.channel = next;
              this.log('machine', 'Re-sent', `${rec.vesselName}: no acknowledgment in ${ds.resendMinutes} min, re-sent by ${next === 'push' ? 'push notification' : next === 'sms' ? 'text message' : 'VHF'}. Simulated boat.`);
            }
          }
          if (waited >= ds.vhfCardMinutes && !rec.notResponding) {
            rec.notResponding = true;
            const facts = this.wordingFacts(null, z!, n.responsePlan ?? this.slowPlan(mask!), null);
            const script = `${rec.vesselName}, ${rec.vesselName}, this is ${this.station}. ${reasonAt(n.publicReason, facts.nearPlace)}. ${entry.instructionText.charAt(0)}${entry.instructionText.slice(1).toLowerCase()}. Acknowledge on channel 12. Over.`;
            this.raiseCard(`vhf:${n.id}:${vid}`, {
              kind: 'notResponding', title: `${rec.vesselName} not responding`,
              body: `No acknowledgment after ${ds.vhfCardMinutes} minutes on the app and ${rec.channel === 'push' ? 'push' : 'text'}. Call on VHF channel 12. The script is ready.`,
              facts: [`Priority ${entry.priority}`, `${entry.minutesToZone !== null ? `${minutesLabel(entry.minutesToZone)} from the zone` : 'On its route'}`, inside ? 'Inside the zone now' : 'Not yet in the zone'],
              actions: [{ id: 'called', label: 'Called on VHF', primary: true }, { id: 'dismiss', label: 'Dismiss' }],
              contactId: z?.contactId ?? null, noticeId: n.id, draftId: null, script,
            });
          }
        }
      }
    }
  }

  private onAcknowledged(n: NoticeRec, vesselId: string, entry: VesselPlanEntry, actor: string): void {
    const craft = this.craft.find((c) => c.id === vesselId);
    if (!craft) return;
    if (entry.action === 'wait') { craft.held = true; return; }
    if ((entry.action === 'reroute' || entry.action === 'leave') && entry.newRoute && craft.rerouteNoticeId !== n.id && !craft.ignoresNotices) {
      const z = this.zones.get(n.zoneId);
      const fresh = z && z.kind === 'keepOut' ? rerouteAround(this.h.grid, remainingRoute(craft), z.geometry.mask, craft.speedMps) : null;
      const cells = fresh && fresh.status !== 'clear' && fresh.status !== 'noPath' && fresh.status !== 'destinationInZone' ? fresh.cells : entry.newRoute;
      applyRoute(this.h, craft, cells, n.id, fresh?.addedMin ?? entry.addedMin);
      if (actor !== 'simulated') this.log(actor, 'Route changed', `${craft.name} follows the new route (${signedMinutes(craft.addedMin)})`);
    }
  }

  clearNotice(noticeId: string, actor: string, logIt = true, reason = 'All clear'): void {
    const n = this.notices.get(noticeId);
    if (!n || n.status !== 'active') return;
    n.status = reason === 'Expired' ? 'expired' : 'cleared';
    const z = this.zones.get(n.zoneId);
    if (z) this.zones.delete(z.id);
    for (const c of this.craft) {
      if (c.rerouteNoticeId === noticeId) restoreRoute(this.h, c);
      c.held = false;
    }
    this.removeCards((k) => k.noticeId === noticeId);
    const words = allClearWording(this.station, z ? this.placeNear(z.centerCell) : '', this.simMin);
    this.allClearRecent.push({ id: noticeId, publicReason: n.publicReason, atWall: this.wall(), atMin: this.simMin, approvedBy: actor === 'officer' ? this.officer : 'Expired' });
    this.lastAllClearMin = this.simMin;
    if (logIt || reason === 'Expired') this.log(actor, reason, `${n.publicReason} near ${z ? this.placeNear(z.centerCell) : 'the harbor'}. ${words.vhf}`);
    for (const [vid, entry] of n.perVessel) {
      const craft = this.craft.find((c) => c.id === vid);
      if (craft?.phone && this.captains.get(vid)?.connected && (entry.priority === 'P1' || entry.priority === 'P2')) {
        this.effects.pushes.push({ vesselId: vid, priority: 'P3', tag: n.id, url: '/captain', title: 'ALL CLEAR', body: `${n.publicReason} lifted. Resume normal navigation.` });
      }
    }
  }

  allClear(noticeId?: string): void {
    if (noticeId) { this.clearNotice(noticeId, 'officer'); return; }
    const active = [...this.notices.values()].filter((n) => n.status === 'active');
    for (const n of active) this.clearNotice(n.id, 'officer', false);
    for (const c of [...this.contacts.values()]) if (c.classification.threatScored && c.classification.kind !== 'debris') this.contacts.delete(c.id);
    for (const z of [...this.zones.values()]) if (z.status === 'draft' && (!z.contactId || !this.contacts.has(z.contactId))) this.removeZone(z.id);
    this.drafts.forEach((d) => { if (!this.zones.has(d.zoneId)) this.drafts.delete(d.id); });
    this.cards = this.cards.filter((k) => k.contactId === null || this.contacts.has(k.contactId));
    this.log('officer', 'All clear', `${active.length} notice${active.length === 1 ? '' : 's'} lifted on every phone. Tracking ended for handed-off contacts. Nothing was closed.`);
  }

  private raiseCard(key: string, card: Omit<P.Card, 'id' | 'createdAtMin' | 'realerts' | 'backupCalled'>): void {
    if (this.dismissed.has(key)) return;
    const existing = this.cards.find((k) => k.key === key);
    if (existing) { existing.body = card.body; existing.facts = card.facts; existing.script = card.script ?? existing.script; existing.title = card.title; return; }
    this.cards.push({ ...card, id: this.id('card'), key, createdAtMin: this.simMin, realerts: 0, backupCalled: false, lastAlertMin: this.simMin, rank: CARD_RANK[card.kind] });
    this.cards.sort((a, b) => a.rank - b.rank || a.createdAtMin - b.createdAtMin);
    this.log('machine', 'Card raised', card.title);
  }

  private removeCards(pred: (k: CardRec) => boolean): void { this.cards = this.cards.filter((k) => !pred(k)); }

  private updateCards(): void {
    const o = this.orders();
    const top = this.cards[0];
    if (!top) return;
    if (this.simMin - top.lastAlertMin >= o.realertMinutes) {
      top.realerts++;
      top.lastAlertMin = this.simMin;
      this.log('machine', 'Re-alert', `${top.title} (no answer for ${Math.round(this.simMin - top.createdAtMin)} min). It will not act on its own.`);
    }
    if (!top.backupCalled && this.simMin - top.createdAtMin >= o.backupOfficerMinutes) {
      top.backupCalled = true;
      this.log('machine', 'Backup officer called', `${top.title} unanswered for ${o.backupOfficerMinutes} min`);
    }
  }

  cardAction(cardId: string, actionId: string): void {
    const card = this.cards.find((k) => k.id === cardId);
    if (!card) return;
    const done = () => { this.removeCards((k) => k.id === cardId); this.dismissed.add(card.key); };
    switch (actionId) {
      case 'publish':
        if (card.draftId) this.publish(card.draftId);
        done();
        return;
      case 'publishZone': {
        const z = card.contactId ? this.zones.get(`z-${card.contactId}`) : undefined;
        if (z?.draftId) this.publish(z.draftId);
        done();
        return;
      }
      case 'discard':
        if (card.draftId) this.discardDraft(card.draftId);
        done();
        return;
      case 'approve': {
        const c = card.contactId ? this.contacts.get(card.contactId) : undefined;
        const tgtId = card.key.split(':')[2];
        const tgt = this.h.targets.find((x) => x.id === tgtId);
        if (tgt) {
          const held = this.craft.filter((k) => Math.hypot(...this.diff(k.toCell, tgt.cell)) <= 8);
          for (const k of held) k.held = true;
          this.log('officer', 'Berth held', `${tgt.short ?? tgt.name} held for ${c?.spec.label ?? 'the contact'}. ${held.length} boats wait. Nothing else closed.`, () => { for (const k of held) k.held = false; this.log('officer', 'Berth released', tgt.short ?? tgt.name); });
        }
        done();
        return;
      }
      case 'send':
        this.log('officer', card.kind === 'person' ? 'Port police brief sent' : 'Coast Guard brief sent', `${card.title}. Simulated: drafted and marked sent, no message leaves this laptop.`);
        done();
        return;
      case 'called': {
        const [, noticeId, vesselId] = card.key.split(':');
        this.markVhfCalled(noticeId, vesselId);
        done();
        return;
      }
      default:
        this.log('officer', 'Card closed', `${card.title}: ${actionId === 'notNow' ? 'not now' : 'dismissed'}`);
        done();
    }
  }

  private diff(a: number, b: number): [number, number] {
    const [ax, ay] = this.h.grid.xy(a), [bx, by] = this.h.grid.xy(b);
    return [ax - bx, ay - by];
  }

  recordResend(noticeId: string, vesselId: string, channel: P.Channel | null): void {
    const rec = this.deliveries.get(`${noticeId}:${vesselId}`);
    if (!rec) return;
    if (channel) rec.channel = channel;
    const how = channel === 'push' ? 'push notification' : channel === 'sms' ? 'text message' : 'no second channel available; VHF next';
    this.log('machine', 'Re-sent', `${rec.vesselName}: no acknowledgment in ${this.settings.delivery.resendMinutes} min, ${channel ? `re-sent by ${how}` : how}`);
  }

  markVhfCalled(noticeId: string, vesselId: string): void {
    const rec = this.deliveries.get(`${noticeId}:${vesselId}`);
    const n = this.notices.get(noticeId);
    if (!rec || !n) return;
    rec.vhfCalled = true;
    rec.channel = 'vhf';
    rec.states.acknowledged ??= this.simMin;
    rec.notResponding = false;
    const entry = n.perVessel.get(vesselId);
    const craft = this.craft.find((c) => c.id === vesselId);
    if (craft) craft.ignoresNotices = false;
    if (entry) this.onAcknowledged(n, vesselId, entry, 'officer');
    this.log('officer', 'Called on VHF', `${rec.vesselName} acknowledged on channel 12`);
  }

  undo(auditId: string): void {
    const fn = this.undoers.get(auditId);
    const entry = this.audit.find((a) => a.id === auditId);
    if (!fn || !entry || entry.undone) return;
    fn();
    entry.undone = true;
    this.undoers.delete(auditId);
    this.effects.undone.push(auditId);
    this.log('officer', 'Undone', `${entry.action}: ${entry.detail}`);
  }

  drive(contactId: string, lonlat: LonLat): void {
    const c = this.contacts.get(contactId);
    if (!c || c.spec.mode !== 'driven') return;
    setPointer(this.h, c, this.cellAt(lonlat));
  }

  contactParams(e: P.CommandEvents['contactParams']): void {
    const c = this.contacts.get(e.contactId);
    if (!c) return;
    if (e.sizeM !== undefined) c.spec.sizeM = Math.max(0.2, Math.min(12, e.sizeM));
    if (e.speedMps !== undefined) c.spec.speedMps = Math.max(0.1, Math.min(6, e.speedMps));
    this.evaluate(c);
    this.log('officer', 'Contact readings changed', `${c.spec.label}: ${c.spec.sizeM.toFixed(1)} m, ${c.spec.speedMps.toFixed(1)} m/s. Simulated sensor.`);
  }

  sensorLoss(contactId: string, silent: boolean): void {
    const c = this.contacts.get(contactId);
    if (!c) return;
    c.silent = silent;
    c.silentSinceMin = silent ? this.simMin : null;
    this.log('machine', silent ? 'Sensor lost contact' : 'Sensor regained contact', `${c.spec.label}: ${silent ? 'score frozen, zone grows by top speed times time since last seen' : 'tracking resumed'}`);
    this.respondTo(c);
  }

  removeContact(contactId: string): void {
    const c = this.contacts.get(contactId);
    if (!c) return;
    this.contacts.delete(contactId);
    const z = this.zones.get(`z-${contactId}`);
    if (z && z.status === 'draft') this.removeZone(z.id);
    this.cards = this.cards.filter((k) => k.contactId !== contactId);
    this.log('officer', 'Contact removed', c.spec.label);
  }

  signOrders(officer: string, orders: Record<string, number>): void {
    this.signedOrders = { signedBy: officer, signedAtWall: this.wall(), orders: { ...this.signedOrders.orders, ...orders } };
    this.log('officer', 'Standing Orders signed', `${officer}: ${Object.entries(orders).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }

  setClock(e: P.CommandEvents['clock']): void {
    if (e.timeScale !== undefined) this.timeScale = Math.max(0, Math.min(240, e.timeScale));
    if (e.paused !== undefined) this.paused = e.paused;
    if (e.setHour !== undefined) this.simMin = Math.floor(this.simMin / 1440) * 1440 + e.setHour * 60;
  }

  captainJoin(requested?: string): { vesselId: string; name: string } | null {
    const phones = this.craft.filter((c) => c.phone);
    let pick = requested ? phones.find((c) => c.id === requested) : undefined;
    if (!pick) pick = phones.find((c) => !this.captains.get(c.id)?.connected);
    if (!pick) {
      const seed = fleetSeeds(this.h, 1, 900 + this.captains.size)[0];
      const c = createCraft(this.h, { ...seed, id: `phone${this.captains.size + 1}`, name: `Launch ${this.captains.size + 8}`, phone: true, fleet: false }, this.simMin);
      if (!c) return null;
      this.craft.push(c);
      pick = c;
    }
    this.captains.set(pick.id, { vesselId: pick.id, connected: true, lastSeenWall: this.wall() });
    this.log(`captain:${pick.name}`, 'Captain joined', `${pick.name} joined from a phone`);
    return { vesselId: pick.id, name: pick.name };
  }

  captainLeft(vesselId: string): void {
    const cap = this.captains.get(vesselId);
    if (cap) { cap.connected = false; cap.lastSeenWall = this.wall(); }
  }

  captainEvent(vesselId: string, kind: 'delivered' | 'seen' | 'gotIt', noticeId: string): void {
    const rec = this.deliveries.get(`${noticeId}:${vesselId}`);
    const n = this.notices.get(noticeId);
    const cap = this.captains.get(vesselId);
    if (cap) cap.lastSeenWall = this.wall();
    if (!rec || !n) return;
    const t = this.simMin;
    rec.simulated = false;
    rec.plannedDelivered = rec.plannedSeen = rec.plannedAck = null;
    if (kind === 'delivered') rec.states.delivered ??= t;
    if (kind === 'seen') { rec.states.delivered ??= t; rec.states.seen ??= t; }
    if (kind === 'gotIt') {
      rec.states.delivered ??= t; rec.states.seen ??= t;
      if (rec.states.acknowledged === undefined) {
        rec.states.acknowledged = t;
        rec.notResponding = false;
        this.removeCards((k) => k.key === `vhf:${noticeId}:${vesselId}`);
        const entry = n.perVessel.get(vesselId);
        this.log(`captain:${rec.vesselName}`, 'Got it', `${rec.vesselName} acknowledged ${entry?.priority ?? ''} ${entry?.instructionText ?? n.instructionText}`);
        if (entry) this.onAcknowledged(n, vesselId, entry, `captain:${rec.vesselName}`);
      }
    }
  }

  onTimeRows(): P.OnTimeRow[] {
    const t = this.simMin;
    const late = this.settings.ais.onTimeLateMinutes;
    return this.craft.filter((c) => !c.fleet).map((c) => {
      const ours = ourArrivalMin(this.h, c, t);
      const planned = plannedArrivalMin(c);
      const delta = ours - (c.tripStartMin + c.naturalMin);
      const status: P.OnTimeRow['status'] = c.dwellUntilMin !== null ? 'berthed' : c.held ? 'at risk' : ours > planned + late ? 'late' : ours > planned ? 'at risk' : 'on time';
      const to = this.placeNear(c.toCell);
      return {
        id: c.id, name: c.name, type: c.type, source: 'simulated', destination: to, plannedLabel: clockLabel(planned), ourEtaLabel: clockLabel(ours),
        deltaMin: Math.round(delta * 10) / 10, status,
        why: c.held ? 'Held: waiting for the berth to reopen' : c.rerouteNoticeId ? `Rerouted around a zone, ${signedMinutes(c.addedMin)}` : c.dwellUntilMin !== null ? 'Alongside' : 'On its planned route',
      };
    });
  }

  private zoneView(z: ZoneRec): P.ZoneView {
    return {
      id: z.id, kind: z.kind, reason: z.reason, status: z.status, rings: z.geometry.rings,
      centerline: z.geometry.centerline.filter((_, i) => i % 2 === 0).map((c) => this.lonlatOf(c)),
      radiusM: z.radiusM, movingTowardDeg: z.movingSpeedMps > 0 ? z.movingTowardDeg : null, movingSpeedMps: z.movingSpeedMps,
      contactId: z.contactId, noticeId: z.noticeId,
    };
  }

  private routeLonLat(cells: number[] | null, every = 2): LonLat[] | null {
    if (!cells || cells.length < 2) return null;
    const out: LonLat[] = [];
    for (let k = 0; k < cells.length; k += every) out.push(this.lonlatOf(cells[k]));
    out.push(this.lonlatOf(cells[cells.length - 1]));
    return out;
  }

  contactView(c: ContactSim): P.ContactView {
    const top = topGoal(c.tell);
    const risk = c.lastRisk;
    const reg = c.spec.registryId ? this.h.registry.find((r) => r.id === c.spec.registryId) : null;
    const f = factors(this.settings, c);
    const kind: P.ContactKind = c.spec.reply === 'friendly' ? 'friendly' : c.classification.kind;
    const tgtName = (id: string) => { const t = this.h.targets.find((x) => x.id === id); return t?.short ?? t?.name ?? id; };
    const eta = top.goal >= 0 ? { targetId: this.h.targets[top.goal].id, name: tgtName(this.h.targets[top.goal].id), minutes: etaToGoal(this.h, c, top.goal) ?? 0 } : null;
    const reasons = c.hostility?.items ?? [];
    return {
      id: c.id, label: c.spec.label, mode: c.spec.mode === 'wander' ? 'bot' : c.spec.mode, scenarioKey: c.spec.scenarioKey ?? null,
      lonlat: contactLonLat(this.h, c), headingDeg: c.headingDeg, speedMps: c.spec.speedMps, sizeM: c.spec.sizeM, heat: c.spec.heat,
      silent: c.silent, silentForMin: c.silent && c.silentSinceMin !== null ? this.simMin - c.silentSinceMin : 0, firstSeenMin: c.spec.firstSeenMin,
      classification: {
        kind, label: kind === 'friendly' ? 'Friendly' : c.classification.label,
        detail: `${c.spec.heat === 'hot' ? 'Hot motor' : c.spec.heat === 'warm' ? 'Warm body' : 'No hot spot'}, ${c.spec.sizeM.toFixed(1)} m, ${c.spec.speedMps.toFixed(1)} m/s ${c.spec.erratic ? 'erratic' : c.spec.mode === 'drift' ? 'with the current' : 'steady'}`,
      },
      registry: { match: reg?.name ?? null, owner: reg?.owner ?? null, divePlan: !!reg?.divePlan, reply: c.spec.reply === 'friendly' ? 'correct' : c.spec.reply === 'spoof' ? 'wrong' : c.pings >= 1 ? 'none' : 'pending', pings: c.pings },
      hostility: {
        H: c.hostility?.H ?? 0,
        items: reasons.map((i) => ({ key: i.key, label: i.label, effect: i.set !== undefined ? `set ${i.set.toFixed(2)}` : `${(i.delta ?? 0) >= 0 ? '+' : ''}${(i.delta ?? 0).toFixed(2)}`, why: '' })),
      },
      capability: { K: c.K, sizeFactor: f.sizeFactor, speedFactor: f.speedFactor },
      odds: oddsRows(c).map((o) => ({ ...o, name: o.kind === 'target' ? tgtName(o.id) : o.name })),
      call: c.tell.call && c.callSinceMin !== null ? { targetId: this.h.targets[c.tell.call.goal].id, name: tgtName(this.h.targets[c.tell.call.goal].id), p: c.tell.post[c.tell.call.goal], sinceMin: c.callSinceMin, etaMin: etaToGoal(this.h, c, c.tell.call.goal) } : null,
      risk: risk ? {
        score: risk.R, level: risk.levelName, rawLevel: risk.rawLevelName, rung: risk.rung, L: risk.best.L, S: risk.best.S,
        targetId: risk.best.id, targetName: tgtName(risk.best.id), urgent: risk.urgent, notes: risk.rules.map((r) => r.label),
        perTarget: risk.perTarget.map((p) => ({ id: p.id, name: tgtName(p.id), p: p.odds, L: p.L, S: p.S, R: p.R })),
      } : null,
      eta,
      predicted: c.classification.threatScored ? predictedPaths(this.h, c, 2).map((p) => this.routeLonLat(p, 3) ?? []) : [],
      track: c.track.filter((_, i) => i % 2 === 0).map((cell) => this.lonlatOf(cell)),
      zoneId: this.zones.has(`z-${c.id}`) ? `z-${c.id}` : null,
      why: this.contactWhy(c),
      history: c.history,
      historyIds: [...this.h.targets.map((t) => t.id), 'lost'],
    };
  }

  private contactWhy(c: ContactSim): string {
    const kind = c.classification.kind;
    if (c.spec.reply === 'friendly') return 'Positive ID: registry match and the correct reply to the ID ping. Shown in green, nothing else.';
    if (kind === 'animal') return 'Warm, large and erratic: a marine animal. Never scored as a threat; boats slow down.';
    if (kind === 'person') return 'Warm body about 2 m moving slowly: a person in the water. Boats are routed away and port police are told.';
    const top = topGoal(c.tell);
    const r = c.lastRisk;
    if (kind === 'debris') {
      const reg = c.spec.registryId ? this.h.registry.find((x) => x.id === c.spec.registryId) : null;
      return reg ? `Lost, not hostile. ${reg.name} is cold and moving with the current.` : 'Cold and moving with the current: debris or a dead robot. A navigation hazard, not a threat.';
    }
    if (!r) return 'Watching.';
    if (top.goal === LOST || top.goal === DRIFT) return `No clear target yet; ${top.goal === DRIFT ? 'it moves like the current' : 'it looks lost'}. Risk ${r.R} (${r.levelName}).`;
    const tgt = this.h.targets[top.goal];
    return `${tgt.short ?? tgt.name} is the likeliest target at ${Math.round(top.p * 100)}%, about ${minutesLabel(etaToGoal(this.h, c, top.goal))} out. Risk ${r.R}: ${r.levelName}, ${rungName(r.level).toLowerCase()}.`;
  }

  commandSnapshot(extra: { aisOnTime?: P.OnTimeRow[]; joinUrls?: string[] } = {}): P.CommandSnapshot {
    const vessels: P.VesselView[] = [];
    const zoneMasks = [...this.zones.values()].filter((z) => z.status === 'published').map((z) => z.geometry.mask);
    for (const c of this.craft) {
      const rerouted = !!c.rerouteNoticeId;
      const cell = currentCell(c);
      const cap = this.captains.get(c.id);
      vessels.push({
        id: c.id, name: c.name, type: c.type, lonlat: craftLonLat(this.h, c), headingDeg: c.headingDeg, speedKn: c.held || c.dwellUntilMin !== null ? 0 : mpsToKnots(c.speedMps),
        source: 'simulated', lengthM: null,
        route: rerouted ? null : this.routeLonLat(remainingRoute(c), 3),
        newRoute: rerouted ? this.routeLonLat(remainingRoute(c), 3) : null,
        phone: c.phone ? { joined: cap?.connected ?? false, captain: cap?.connected ? 'Phone' : null } : null,
        inZone: zoneMasks.some((m) => m[cell] === 1),
      });
    }
    for (const v of this.ais) {
      vessels.push({
        id: `ais-${v.mmsi}`, name: v.name || `MMSI ${v.mmsi}`, type: v.typeLabel, lonlat: [v.lon, v.lat], headingDeg: v.headingDeg ?? v.cogDeg, speedKn: v.sogKn,
        source: v.source === 'live' ? 'ais-live' : 'ais-replay', lengthM: v.lengthM, route: null, newRoute: null, phone: null,
        inZone: v.cell >= 0 && zoneMasks.some((m) => m[v.cell] === 1),
      });
    }
    const top = this.cards[0];
    return {
      clock: this.clockView(),
      contacts: [...this.contacts.values()].map((c) => this.contactView(c)),
      vessels,
      zones: [...this.zones.values()].map((z) => this.zoneView(z)),
      drafts: [...this.drafts.values()].map((d) => this.publicDraft(d)),
      notices: [...this.notices.values()].filter((n) => n.status === 'active' || this.simMin - n.publishedAtMin < 240).map((n) => this.publicNotice(n)),
      deliveries: [...this.deliveries.values()].filter((d) => this.notices.get(d.noticeId)?.status === 'active').map((d) => ({
        noticeId: d.noticeId, vesselId: d.vesselId, vesselName: d.vesselName, simulated: d.simulated, channel: d.channel, priority: d.priority,
        states: d.states, resends: d.resends, notResponding: d.notResponding,
      })),
      card: top ? { id: top.id, kind: top.kind, title: top.title, body: top.body, facts: top.facts, actions: top.actions, createdAtMin: top.createdAtMin, realerts: top.realerts, backupCalled: top.backupCalled, contactId: top.contactId, noticeId: top.noticeId, draftId: top.draftId, script: top.script } : null,
      cardsWaiting: Math.max(0, this.cards.length - 1),
      onTime: [...this.onTimeRows(), ...(extra.aisOnTime ?? [])],
      audit: this.audit.slice(-80).reverse(),
      marineLog: this.marineLog.slice(-30).reverse(),
      orders: this.signedOrders,
      sources: { ...this.sources, ais: { ...this.sources.ais, vessels: this.ais.length } },
      berths: { cruiseDocked: this.cruiseDocked, cruiseShip: this.cruiseShip },
      captains: [...this.captains.values()].map((c) => ({ vesselId: c.vesselId, vesselName: this.craft.find((k) => k.id === c.vesselId)?.name ?? c.vesselId, connected: c.connected, lastSeenWall: c.lastSeenWall })),
      officer: this.officer,
      joinUrls: extra.joinUrls ?? [],
    };
  }

  private publicDraft(d: DraftRec): P.NoticeDraft {
    const { responsePlan, wordingKey, factsKey, wordingInFlight, officerRadius, officerInstruction, ...rest } = d;
    void responsePlan; void wordingKey; void factsKey; void wordingInFlight; void officerRadius; void officerInstruction;
    return rest;
  }

  private publicNotice(n: NoticeRec): P.Notice {
    const { perVessel, responsePlan, ...rest } = n;
    void perVessel; void responsePlan;
    const clean = { ...rest } as P.Notice & Partial<DraftRec>;
    delete clean.wordingKey; delete clean.factsKey; delete clean.wordingInFlight; delete clean.officerRadius; delete clean.officerInstruction; delete clean.responsePlan;
    return clean;
  }

  clockView(): P.ClockView {
    return { simMin: this.simMin, label: clockLabel(this.simMin), timeScale: this.timeScale, paused: this.paused, night: this.night };
  }

  private proposedRoute(c: CraftSim): number[] | null {
    const here = currentCell(c);
    for (const n of this.notices.values()) {
      if (n.status !== 'active') continue;
      const entry = n.perVessel.get(c.id);
      if (!entry?.newRoute) continue;
      const start = entry.newRoute.indexOf(here);
      return start >= 0 ? entry.newRoute.slice(start) : entry.newRoute;
    }
    return null;
  }

  captainSnapshot(vesselId: string): P.CaptainSnapshot {
    const c = this.craft.find((k) => k.id === vesselId);
    const notices: P.CaptainNotice[] = [];
    if (c) {
      const here = craftLonLat(this.h, c);
      for (const n of this.notices.values()) {
        if (n.status !== 'active') continue;
        const entry = n.perVessel.get(vesselId);
        const z = this.zones.get(n.zoneId);
        if (!entry || !z) continue;
        const rec = this.deliveries.get(`${n.id}:${vesselId}`);
        let nearest = Infinity;
        let nearestPoint: LonLat | null = null;
        for (const poly of z.geometry.rings) for (const ring of poly) for (const p of ring) { const d = metersBetween(here, p); if (d < nearest) { nearest = d; nearestPoint = p; } }
        const inside = z.geometry.mask[currentCell(c)] === 1;
        const side = nearestPoint ? compassPoint(bearingDeg(here, nearestPoint)) : null;
        const moving = z.movingSpeedMps > 0 && z.movingTowardDeg !== null ? `, moving ${compassPoint(z.movingTowardDeg)} at about ${Math.max(1, Math.round(mpsToKnots(z.movingSpeedMps)))} kn` : '';
        const relative = inside ? `You are inside the zone${moving}.` : side ? `${side.charAt(0).toUpperCase()}${side.slice(1)} of you${moving}.` : null;
        const ackAt = rec?.states.acknowledged;
        notices.push({
          id: n.id, kind: n.kind, priority: entry.priority, instructionText: entry.instructionText, publicReason: n.publicReason,
          zone: { rings: z.geometry.rings, centerline: this.zoneView(z).centerline, movingTowardDeg: z.movingSpeedMps > 0 ? z.movingTowardDeg : null, movingSpeedMps: z.movingSpeedMps, kind: z.kind },
          validUntilWall: new Date(this.wallMs + ((n.expiresAtMin - this.simMin) * 60_000) / Math.max(1, this.timeScale)).toISOString(),
          validUntilLabel: clockLabel(n.expiresAtMin), publishedAtWall: n.publishedAtWall, publishedAtLabel: clockLabel(n.publishedAtMin), approvedBy: n.approvedBy,
          detail: inside ? 'You are inside the zone.' : entry.minutesToZone !== null ? `Your route reaches it in ${minutesLabel(entry.minutesToZone)}.` : 'Not on your route.',
          place: this.placeNear(z.centerCell), relative, acknowledgedAtLabel: ackAt !== undefined ? clockLabel(ackAt) : null,
          addedMin: entry.addedMin, rerouted: !!entry.newRoute || c.rerouteNoticeId === n.id,
          distanceM: inside ? 0 : isFinite(nearest) ? nearest : null, minutesToZone: entry.minutesToZone,
          acknowledged: rec?.states.acknowledged !== undefined, translations: n.wording.translations,
        });
      }
    }
    const order: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
    notices.sort((a, b) => order[a.priority] - order[b.priority]);
    const rerouted = !!c?.rerouteNoticeId;
    const proposal = !rerouted && c ? this.proposedRoute(c) : null;
    return {
      vessel: c ? {
        id: c.id, name: c.name, type: c.type, lonlat: craftLonLat(this.h, c), headingDeg: c.headingDeg, speedKn: c.held ? 0 : mpsToKnots(c.speedMps),
        route: rerouted ? null : this.routeLonLat(remainingRoute(c), 3),
        newRoute: rerouted ? this.routeLonLat(remainingRoute(c), 3) : proposal ? this.routeLonLat(proposal, 3) : null,
      } : null,
      notices,
      traffic: [
        ...this.craft.filter((k) => k.id !== vesselId).map((k) => ({ lonlat: craftLonLat(this.h, k), headingDeg: k.headingDeg, type: k.type })),
        ...this.ais.map((v) => ({ lonlat: [v.lon, v.lat] as LonLat, headingDeg: v.headingDeg ?? v.cogDeg, type: v.typeLabel })),
      ],
      allClear: this.allClearRecent.map(({ id, publicReason, atWall, atMin, approvedBy }) => ({ id, publicReason, atWall, atLabel: clockLabel(atMin), approvedBy })),
      lastAllClearLabel: this.lastAllClearMin !== null ? clockLabel(this.lastAllClearMin) : null,
      clock: this.clockView(),
      serverWall: this.wall(),
    };
  }

  handle<K extends keyof P.CommandEvents>(name: K, payload: P.CommandEvents[K]): void {
    const p = payload as never;
    switch (name) {
      case 'drive': { const e = p as P.CommandEvents['drive']; this.drive(e.contactId, e.lonlat); return; }
      case 'spawn': this.spawn(p); return;
      case 'removeContact': this.removeContact((p as P.CommandEvents['removeContact']).contactId); return;
      case 'contactParams': this.contactParams(p); return;
      case 'sensorLoss': { const e = p as P.CommandEvents['sensorLoss']; this.sensorLoss(e.contactId, e.silent); return; }
      case 'editDraft': this.editDraft(p); return;
      case 'publish': this.publish((p as P.CommandEvents['publish']).draftId); return;
      case 'discardDraft': this.discardDraft((p as P.CommandEvents['discardDraft']).draftId); return;
      case 'dropZone': this.dropZone(p); return;
      case 'allClear': this.allClear((p as P.CommandEvents['allClear']).noticeId); return;
      case 'cardAction': { const e = p as P.CommandEvents['cardAction']; this.cardAction(e.cardId, e.actionId); return; }
      case 'clock': this.setClock(p); return;
      case 'undo': this.undo((p as P.CommandEvents['undo']).auditId); return;
      case 'signOrders': { const e = p as P.CommandEvents['signOrders']; this.signOrders(e.officer, e.orders); return; }
      case 'officer': this.officer = (p as P.CommandEvents['officer']).name || this.officer; return;
      case 'reset': this.resetHarbor((p as P.CommandEvents['reset']).mode); return;
      case 'markVhfCalled': { const e = p as P.CommandEvents['markVhfCalled']; this.markVhfCalled(e.noticeId, e.vesselId); return; }
    }
  }

  bearingFrom(a: LonLat, b: LonLat): number { return bearingDeg(a, b); }
}

export function createWorld(o: WorldOptions): World {
  return new World(o);
}

export function dilateMask(w: World, mask: Uint8Array, meters: number): Uint8Array {
  return dilate(w.h.grid, mask, meters / w.h.grid.cellMeters);
}
