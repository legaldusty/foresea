import type { Harbor } from './harbor';
import type { Settings } from './settings';
import { nearestWater, walkLine } from './grid';
import { topGoal, targetOdds, lostOnlyOdds, driftOdds, LOST, DRIFT, type CurrentVector } from './tell';
import { HIGH, CRITICAL, SERIOUS, levelName, rungName } from './risk';
import { INCIDENTS } from './scenarios';
import {
  createContact, moveContact, evaluateContact, contactLonLat, oddsRows, setPointer, factors, etaToGoal, recordOdds,
  type ContactSim, type ContactSpec,
} from './contact';
import {
  createCraft, moveCraft, craftLonLat, remainingRoute, applyRoute, restoreRoute, currentCell, plannedArrivalMin, ourArrivalMin, fleetSeeds, clearFix,
  type CraftSim,
} from './craft';
import { circleZone, type ZoneGeometry } from './zones';
import { forecastPaths, forecastShapes, type Forecast, type ForecastShapes, type ForecastOptions } from './forecast';
import {
  buildNoticeArea, noticeAreaShapes, overlapShare, planConflicts, planBoat, boatCrossing, priorityForCrossing, fixInstruction,
  type NoticeArea, type PlannerBoat, type PlannerRules, type BoatPlan, type ConflictPlan, type PricedFix, type Crossing,
} from './conflicts';
import { chooseResponse, instructionText, type Boat, type BoatImpact, type ResponsePlan, type Instruction } from './response';
import { dilate, rerouteAround, routeEntersMask } from './routing';
import { minutesUntilZone, priorityFor, lessUrgent, moreUrgent, type Priority } from './priority';
import { templateWording, allClearWording, damagePhrase, reasonAt, type WordingFacts } from './wording';
import { rng } from './bench';
import { clockLabel, isNight, minutesLabel, signedMinutes } from './eta';
import { metersBetween, mpsToKnots, offsetPoint, bearingDeg, compassPoint, type LonLat } from './geo';
import type * as P from '../shared/protocol';
import { workLine, pointAlong, stepAlong, seedSightings, type WorkLine } from './tuesday';

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
  reportedAtMs?: number;
}

interface AisShown { lonlat: LonLat; reportedAtMs: number; correction: [number, number]; correctionAtMs: number }

const AIS_MOVING_KN = 0.5;
const AIS_REACH_MS = 180_000;
const AIS_EASE_MS = 1000;

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
  area?: AreaRec | null;
  changedAtMin?: number | null;
  pendingArea?: AreaRec | null;
  meta?: ZoneMeta;
}

interface ZoneMeta {
  label?: string | null;
  filedBy?: string | null;
  largeShipsOnly?: boolean;
  simulated?: boolean;
  slowKnots?: number;
  startsAtMin?: number | null;
  work?: { line: WorkLine; meters: number; direction: 1 | -1; speedMps: number };
}

interface ScheduledZone {
  id: string;
  label: string;
  filedBy: string;
  cell: number;
  lonlat: LonLat;
  radiusM: number;
  startMin: number;
  endMin: number;
}

interface ForecastRec {
  forecast: Forecast;
  shapes: ForecastShapes;
  version: number;
  madeAtMin: number;
  madeAtWall: number;
  cell: number;
  key: string;
  ticks: P.ForecastTickView[];
}

interface AreaRec {
  area: NoticeArea;
  shapes: ForecastShapes;
  ticks: P.ForecastTickView[];
  version: number;
  key: string;
}

interface DraftRec extends P.NoticeDraft {
  responsePlan: ResponsePlan | null;
  wordingKey: string;
  factsKey: string;
  wordingInFlight: boolean;
  officerRadius: number | null;
  officerInstruction: string | null;
}

interface VesselPlanEntry {
  priority: Priority;
  instruction: Instruction;
  instructionText: string;
  addedMin: number;
  minutesToZone: number | null;
  action: string;
  newRoute: number[] | null;
  untilMin?: number | null;
  crossing?: { layer: Crossing['layer']; atMin: number; droneEarlyMin: number; droneLateMin: number } | null;
  fix?: PricedFix | null;
  fixAtMin?: number;
  fixAreaVersion?: number;
  noGentle?: boolean;
}

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
  urgentSinceMin: number | null;
}

interface CardRec extends P.Card {
  key: string;
  lastAlertMin: number;
  rank: number;
  shownAtWall: number;
  lastAlertWall: number;
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

const CARD_RANK: Record<P.Card['kind'], number> = { person: 0, publish: 1, handoff: 2, notResponding: 3, update: 4, hold: 5, animal: 6, lost: 7, info: 8 };
const KNOT_MPS = 0.514444;
const FIX_LABEL: Record<PricedFix['kind'], string> = { hold: 'Wait', slow: 'Slow down', stepAside: 'Step aside', reroute: 'Short reroute' };
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
  private discardedAtLevel = new Map<string, number>();
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
  forecasts = new Map<string, ForecastRec>();
  private aisShown = new Map<number, AisShown>();
  sightings: P.Sighting[] = [];
  scheduled: ScheduledZone[] = [];
  private tuesdayOpen = false;
  private gliderSilenced = false;
  private forecastSeq = 0;
  private areaSeq = 0;

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
    this.forecasts.clear();
    this.zones.clear();
    this.drafts.clear();
    this.notices.clear();
    this.deliveries.clear();
    this.cards = [];
    this.dismissed.clear();
    this.discardedAtLevel.clear();
    this.allClearRecent = [];
    this.simMin = mode === 'night' ? 2 * 60 : mode === 'tuesday' ? Math.round(this.settings.tuesday.openHour * 60) : 9 * 60;
    this.sightings = [];
    this.scheduled = [];
    this.tuesdayOpen = false;
    this.gliderSilenced = false;
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
    const presetIds = new Set(this.h.craft.map((spec) => spec.id));
    for (const cap of this.captains.values()) if (!presetIds.has(cap.vesselId)) this.captains.delete(cap.vesselId);
    this.log('officer', 'Reset harbor', mode === 'night' ? 'Night watch, 02:00' : mode === 'tuesday' ? `Tuesday operations, ${clockLabel(this.simMin)}` : 'Empty harbor');
    if (mode === 'tuesday') this.openTuesday();
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

  private aisReckoned(v: AisInputVessel, atMs: number): LonLat {
    const here: LonLat = [v.lon, v.lat];
    if (v.sogKn < AIS_MOVING_KN || v.reportedAtMs === undefined) return here;
    const ms = Math.max(0, Math.min(AIS_REACH_MS, atMs - v.reportedAtMs));
    return offsetPoint(here, v.sogKn * KNOT_MPS * (ms / 1000), v.cogDeg);
  }

  private updateAisShown(): void {
    const now = this.wallMs;
    const seen = new Set<number>();
    for (const v of this.ais) {
      seen.add(v.mmsi);
      const target = this.aisReckoned(v, now);
      const prev = this.aisShown.get(v.mmsi);
      if (!prev) { this.aisShown.set(v.mmsi, { lonlat: target, reportedAtMs: v.reportedAtMs ?? 0, correction: [0, 0], correctionAtMs: now }); continue; }
      if ((v.reportedAtMs ?? 0) !== prev.reportedAtMs) {
        prev.correction = [prev.lonlat[0] - target[0], prev.lonlat[1] - target[1]];
        prev.correctionAtMs = now;
        prev.reportedAtMs = v.reportedAtMs ?? 0;
      }
      const left = Math.max(0, 1 - (now - prev.correctionAtMs) / AIS_EASE_MS);
      prev.lonlat = [target[0] + prev.correction[0] * left, target[1] + prev.correction[1] * left];
    }
    for (const id of [...this.aisShown.keys()]) if (!seen.has(id)) this.aisShown.delete(id);
  }

  private aisLonLat(v: AisInputVessel): LonLat {
    return this.aisShown.get(v.mmsi)?.lonlat ?? [v.lon, v.lat];
  }

  cellAt(lonlat: LonLat): number {
    const [x, y] = this.h.grid.toCell(lonlat[0], lonlat[1]);
    return nearestWater(this.h.grid, Math.max(0, Math.min(this.h.grid.nx - 1, x)), Math.max(0, Math.min(this.h.grid.ny - 1, y)), 30);
  }

  lonlatOf(cell: number): LonLat { return this.h.grid.toLonLat(...this.h.grid.xy(cell)) as LonLat; }

  private spawnContact(spec: Omit<ContactSpec, 'id' | 'label' | 'firstSeenMin' | 'seed'> & { seed?: number }, nearness = true): ContactSim {
    const n = ++this.contactSeq;
    const registeredName = spec.registryId ? this.h.registry.find((r) => r.id === spec.registryId)?.name : undefined;
    const full: ContactSpec = { ...spec, id: `C-${n}`, label: registeredName ?? `Contact C-${n}`, firstSeenMin: this.simMin, seed: spec.seed ?? 100 + n };
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

  private needsForecast(c: ContactSim): boolean {
    if (c.spec.reply === 'friendly') return false;
    if (c.classification.threatScored) return true;
    return !!c.spec.registryId && c.classification.kind === 'debris';
  }

  private forecastOptions(): Partial<ForecastOptions> {
    const f = this.settings.forecast;
    return {
      samples: f.samples, beta: f.beta, lostBeta: f.lostBeta, driftSharpness: f.driftSharpness, speedSpread: f.speedSpread, horizonMinutes: f.horizonMinutes,
      radiusCells: f.radiusCells, radiusGrowMinutes: f.radiusGrowMinutes, radiusMaxCells: f.radiusMaxCells, likelyShare: f.likelyShare,
      likelyMaxRadiusCells: f.likelyMaxRadiusCells, carefulShare: f.carefulShare, tickMinutes: f.tickMinutes, seed: f.seed,
    };
  }

  private forecastCurrent(c: ContactSim): { eastMps: number; northMps: number } | null {
    const cur = c.spec.currentOverride !== undefined ? c.spec.currentOverride : this.current;
    return cur ? { eastMps: cur.currentU, northMps: cur.currentV } : null;
  }

  updateForecast(c: ContactSim, force = false): ForecastRec | null {
    if (!this.needsForecast(c)) { this.forecasts.delete(c.id); return null; }
    const prev = this.forecasts.get(c.id);
    if (prev && c.silent) return prev;
    const drifting = c.classification.kind === 'debris';
    const odds = drifting ? this.h.targets.map(() => 0) : targetOdds(c.tell);
    const lost = drifting ? 0 : lostOnlyOdds(c.tell);
    const drift = drifting ? 1 : driftOdds(c.tell);
    const key = `${c.cell}|${odds.map((p) => p.toFixed(2)).join(',')}|${lost.toFixed(2)}|${drift.toFixed(2)}`;
    if (prev && prev.key === key) return prev;
    if (prev && !force && this.wallMs - prev.madeAtWall < this.settings.forecast.everySeconds * 1000) return prev;
    const speedMps = drifting ? Math.max(0.05, this.currentSpeedMps || c.spec.speedMps) : c.spec.speedMps;
    const forecast = forecastPaths(this.h.grid, this.h.fields, { cell: c.cell, speedMps, targetOdds: odds, lost, drift, current: this.forecastCurrent(c) }, this.forecastOptions());
    const shapes = forecastShapes(this.h.grid, forecast, this.settings.forecast.carefulShare);
    const madeAtMin = this.simMin;
    const rec: ForecastRec = {
      forecast, shapes, version: ++this.forecastSeq, madeAtMin, madeAtWall: this.wallMs, cell: c.cell, key,
      ticks: forecast.ticks.map((tk) => ({ lonlat: this.lonlatOf(tk.cell), label: clockLabel(madeAtMin + tk.minutes), minutes: tk.minutes })),
    };
    this.forecasts.set(c.id, rec);
    return rec;
  }

  private areaFor(c: ContactSim, rec: ForecastRec, zoneMeters: number): AreaRec {
    const zone = this.zones.get(`z-${c.id}`);
    const f = this.settings.forecast;
    const silentFor = c.silent && c.silentSinceMin !== null ? Math.floor(this.simMin - c.silentSinceMin) : 0;
    const horizon = Math.min(f.horizonMinutes, f.noticeHorizonMinutes + silentFor);
    const key = `${rec.version}|${zoneMeters}|${horizon}`;
    const cached = zone?.status === 'draft' && zone.area?.key === key ? zone.area : null;
    if (cached) return cached;
    const area = buildNoticeArea(this.h.grid, rec.forecast, rec.cell, c.spec.speedMps, { horizonMinutes: horizon, zoneMeters, carefulShare: f.carefulShare, exitMinutesMax: f.exitMinutesMax }, rec.madeAtMin);
    return { area, shapes: noticeAreaShapes(this.h.grid, area), ticks: rec.ticks.filter((tk) => tk.minutes <= horizon), version: ++this.areaSeq, key };
  }

  private areaGeometry(a: AreaRec): ZoneGeometry {
    const cells: number[] = [];
    for (let j = 0; j < a.area.careful.length; j++) if (a.area.careful[j]) cells.push(j);
    return { centerline: [a.area.contactCell], radiusCells: 0, cells, mask: a.area.careful, rings: a.shapes.careful };
  }

  private plannerRules(): PlannerRules {
    const f = this.settings.forecast;
    const pr = this.settings.priority;
    return {
      padMinutes: f.padMinutes, p1Minutes: pr.p1Minutes, p2Minutes: pr.p2Minutes, maxDelayPerBoatMin: this.orders().maxDelayPerBoatMin,
      minSlowKnots: f.minSlowKnots, stepAsideMaxMeters: f.stepAsideMaxMeters, searchStepMinutes: f.searchStepMinutes,
    };
  }

  private plannerBoat(c: CraftSim): PlannerBoat {
    const t = this.simMin;
    const alongside = c.dwellUntilMin !== null;
    const waiting = c.waitUntilMin !== null && c.waitUntilMin > t;
    const waitIndex = alongside ? 0 : waiting ? Math.max(0, c.waitAtIdx - c.routeIdx) : c.held ? 0 : -1;
    const waitUntilMin = alongside ? (c.dwellUntilMin as number) - t : waiting ? (c.waitUntilMin as number) - t : c.held ? 60 : 0;
    const slowing = c.slowMps !== null && c.slowUntilMin !== null && c.slowUntilMin > t;
    let slowUntilIndex = -1;
    if (slowing) {
      const cellsAhead = (((c.slowUntilMin as number) - t) * 60 * (c.slowMps as number)) / this.h.grid.cellMeters;
      slowUntilIndex = Math.ceil(cellsAhead);
    }
    return {
      id: c.id, name: c.name, route: remainingRoute(c), speedMps: c.speedMps, waitIndex, waitUntilMin, slowUntilIndex,
      slowMps: slowing ? (c.slowMps as number) : c.speedMps, movable: !c.ignoresNotices || true, alongside,
    };
  }

  private aisPlannerBoat(v: AisInputVessel & { cell: number }): PlannerBoat {
    const route = this.aisProjectedRoute(v);
    const speed = Math.max(0.3, v.sogKn * KNOT_MPS);
    return { id: `ais-${v.mmsi}`, name: v.name || `MMSI ${v.mmsi}`, route, speedMps: speed, waitIndex: v.sogKn < 0.5 ? 0 : -1, waitUntilMin: v.sogKn < 0.5 ? 120 : 0, slowUntilIndex: -1, slowMps: speed, movable: false, alongside: v.sogKn < 0.5 };
  }

  private impactOf(b: BoatPlan): BoatImpact {
    return {
      id: b.id, name: b.name, onRoute: !!b.crossing, nearPath: false, insideNow: !!b.crossing && b.crossing.boatMin <= 0, minutesToZone: b.crossing?.boatMin ?? null,
      priority: b.priority, action: b.action, instruction: 'KEEP CLEAR', addedMin: b.addedMin, reroute: null,
      text: fixInstruction(b.fix, b.action), crossing: b.crossing, untilMin: b.untilMin, fix: b.fix, options: b.options, noGentle: b.noGentleOption,
    };
  }

  private securityPlan(a: AreaRec): ResponsePlan {
    const conflict: ConflictPlan = planConflicts(this.h.grid, a.area, this.craft.map((k) => this.plannerBoat(k)), this.simMin, this.plannerRules());
    const affected = conflict.affected.map((b) => this.impactOf(b));
    const everyone = conflict.boats.map((b) => this.impactOf(b));
    const moving = conflict.affected.filter((b) => b.fix);
    const total = conflict.totalAddedMin;
    const reasons = [
      conflict.affected.length ? `${conflict.affected.length} boat${conflict.affected.length === 1 ? '' : 's'} meet the forecast in place and time; everyone else is told on the map.` : 'No boat meets the forecast in place and time.',
      ...conflict.noGentle.map((b) => `No gentle option for ${b.name} within ${this.orders().maxDelayPerBoatMin} min.`),
    ];
    return {
      kind: 'giveWay', affected, everyone, totalAddedMin: total, maxAddedMin: conflict.maxAddedMin, clears: conflict.noGentle.length === 0,
      withinOrders: conflict.noGentle.length === 0, blockedBerth: null, reasons,
      nextStepUp: { kind: 'hold', text: 'Hold one berth: ships due there wait' },
      comparison: {
        chosen: moving.length ? `Giving way: ${moving.length} boat${moving.length === 1 ? '' : 's'} act, +${Math.round(total)} boat-min, no gate closed` : `Heads-up only: ${conflict.affected.length} boat${conflict.affected.length === 1 ? '' : 's'}, no delay`,
        closeHarbor: 'Closing the harbor: every ship delayed',
      },
    };
  }

  private checkForecastUpdate(c: ContactSim, zone: ZoneRec, fresh: AreaRec, confident: boolean): void {
    const published = zone.area;
    const n = zone.noticeId ? this.notices.get(zone.noticeId) : undefined;
    if (!published || !n || n.status !== 'active') return;
    const newTarget = confident && fresh.area.topTarget !== published.area.topTarget;
    const moved = overlapShare(fresh.area.likely, published.area.likely) < this.settings.forecast.updateOverlapMin;
    const left = !published.area.careful[c.cell];
    if (!newTarget && !moved && !left) { zone.pendingArea = null; this.removeCards((k) => k.key.startsWith(`update:${zone.id}`)); return; }
    zone.pendingArea = fresh;
    const target = this.h.targets[fresh.area.topTarget];
    const targetName = target?.short ?? target?.name ?? 'a new target';
    const why = newTarget ? `The forecast now points at ${targetName}.` : left ? `${c.spec.label} has left the published area.` : 'The likely path has moved away from the published area.';
    if (!newTarget && this.orders().autoPublishForecastUpdates >= 1) {
      this.applyAreaUpdate(zone, n, fresh, 'machine', `${why} Same target; published under Standing Orders.`);
      return;
    }
    const key = `update:${zone.id}:${newTarget ? fresh.area.topTarget : 'shape'}`;
    this.removeCards((k) => k.key.startsWith(`update:${zone.id}`) && k.key !== key);
    this.raiseCard(key, {
      kind: 'update', title: newTarget ? `Forecast update: now ${targetName}` : 'Forecast update',
      body: `${why} Publish the new area so captains see where it is going now.`,
      facts: [newTarget ? 'New target: needs your tap' : 'Same target', `Overlap with the published area ${Math.round(overlapShare(fresh.area.likely, published.area.likely) * 100)}%`],
      actions: [{ id: 'publishUpdate', label: 'Publish update', primary: true }, { id: 'notNow', label: 'Not now' }],
      contactId: c.id, noticeId: n.id, draftId: null, script: null,
    });
  }

  private applyAreaUpdate(zone: ZoneRec, n: NoticeRec, fresh: AreaRec, actor: string, detail: string): void {
    zone.area = fresh;
    zone.geometry = this.areaGeometry(fresh);
    zone.centerCell = fresh.area.contactCell;
    zone.changedAtMin = this.simMin;
    zone.pendingArea = null;
    for (const entry of n.perVessel.values()) { entry.fix = null; entry.fixAreaVersion = -1; }
    this.removeCards((k) => k.key.startsWith(`update:${zone.id}`));
    this.log(actor, 'Forecast update published', detail);
  }

  forecastViews(): P.ForecastView[] {
    const out: P.ForecastView[] = [];
    for (const [id, rec] of this.forecasts) {
      if (!this.contacts.has(id)) continue;
      out.push({ contactId: id, version: rec.version, likely: rec.shapes.likely, careful: rec.shapes.careful, ticks: rec.ticks });
    }
    return out;
  }

  private forecastSummary(c: ContactSim): P.ForecastSummary | null {
    const rec = this.forecasts.get(c.id);
    if (!rec) return null;
    const f = rec.forecast;
    const drifting = c.classification.kind === 'debris';
    const tgt = drifting ? null : this.h.targets[f.topTarget];
    const p = drifting ? 0 : targetOdds(c.tell)[f.topTarget] ?? 0;
    const name = tgt ? (tgt.short ?? tgt.name) : null;
    const arrival = !drifting && f.arrival && tgt ? { name: name as string, share: f.arrival.share, earlyLabel: clockLabel(rec.madeAtMin + f.arrival.early), lateLabel: clockLabel(rec.madeAtMin + f.arrival.late) } : null;
    const words = drifting
      ? `Drifting with the current. The yellow area is where to search.`
      : arrival ? `${name} ${Math.round(p * 100)}%, arrives ${arrival.earlyLabel} to ${arrival.lateLabel}.`
      : name ? `${name} ${Math.round(p * 100)}%, not sure when.` : 'No clear target yet.';
    return { version: rec.version, madeAtLabel: clockLabel(rec.madeAtMin), topId: tgt?.id ?? null, topName: name, topP: p, arrival, words, drifting };
  }

  private dayStartMin(): number {
    return Math.floor(this.simMin / 1440) * 1440;
  }

  private openScheduledZone(id: string, kind: 'keepOut' | 'slow', reason: P.PublicReason, lonlat: LonLat, radiusM: number, instruction: Instruction, meta: ZoneMeta, startMin: number, endMin: number): string | null {
    const draftId = this.upsertRoutineZone(`z-${id}`, kind, reason, this.cellAt(lonlat), radiusM, null, instruction, meta.label ?? null, { ...meta, startsAtMin: startMin });
    if (!draftId) return null;
    const noticeId = this.publish(draftId, 'machine');
    const n = noticeId ? this.notices.get(noticeId) : undefined;
    if (n) {
      n.publishedAtMin = Math.min(n.publishedAtMin, startMin);
      n.expiresAtMin = endMin;
      n.validForMin = endMin - n.publishedAtMin;
    }
    return noticeId;
  }

  private openTuesday(): void {
    const t = this.settings.tuesday;
    const day = this.dayStartMin();
    this.tuesdayOpen = true;
    this.sightings = seedSightings(this.settings, day);
    const dive = t.dive;
    this.openScheduledZone(dive.id, 'slow', 'Divers in water', [dive.lon, dive.lat], dive.radiusM * 2, 'SLOW',
      { label: dive.label, filedBy: dive.filedBy, simulated: true, slowKnots: dive.slowKnots }, day + dive.startHour * 60, day + dive.endHour * 60);
    this.log('system', 'Dive plan active', `${dive.label}, ${clockLabel(day + dive.startHour * 60)} to ${clockLabel(day + dive.endHour * 60)}, filed by ${dive.filedBy}. Divers keep ${dive.radiusM} m; boats nearby slow to ${dive.slowKnots} kn. Simulated schedule.`);
    this.spawnContact({ mode: 'bot', startCell: this.cellAt([dive.lon + 0.0008, dive.lat - 0.0004]), sizeM: 1.2, speedMps: 0.5, heat: 'hot', reply: 'friendly', registryId: dive.robot, planFiled: true, plan: [{ goal: 'pier400', sloppy: 0.6 }] });
    const dr = t.dredge;
    const line = workLine(dr.line as LonLat[]);
    const start = pointAlong(line, line.lengthM * 0.35);
    this.openScheduledZone(dr.id, 'keepOut', 'Dredge working', start.lonlat, dr.radiusM, 'KEEP CLEAR',
      { label: dr.label, filedBy: dr.filedBy, simulated: true, work: { line, meters: line.lengthM * 0.35, direction: 1, speedMps: dr.speedKn * KNOT_MPS } }, day + dr.startHour * 60, day + dr.endHour * 60);
    this.log('system', 'Work zone active', `${dr.label}, weekdays ${clockLabel(day + dr.startHour * 60)} to ${clockLabel(day + dr.endHour * 60)}, ${dr.filedBy}. The zone moves along the work line. Simulated schedule.`);
    const wh = t.whale;
    const reportedAt = day + Math.round(wh.reportedHour * 60);
    const confirmedAt = day + Math.round(wh.confirmedHour * 60);
    this.sightings.unshift({ id: 's-whale-today', species: 'whale', lonlat: [wh.lon, wh.lat], atMin: reportedAt, dayOffset: 0, whenLabel: '', source: 'ship crew', reporter: wh.reportedBy, status: 'confirmed', simulated: true, note: 'Blue whale surfacing in the approach lanes, confirmed by the desk' });
    this.openScheduledZone(wh.id, 'slow', 'Whale nearby', [wh.lon, wh.lat], wh.radiusM, 'SLOW',
      { label: wh.label, filedBy: `Reported by ${wh.reportedBy.toLowerCase()}, confirmed by the desk ${clockLabel(confirmedAt)}`, simulated: true, slowKnots: wh.slowKnots, largeShipsOnly: true }, confirmedAt, day + 18 * 60);
    this.log('system', 'Whale slow zone active', `${wh.label}: ships over 300 tons slow to ${wh.slowKnots} kn within ${(wh.radiusM / 1852).toFixed(1)} nm, as the Protecting Blue Whales and Blue Skies program asks off California. Reported ${clockLabel(reportedAt)}, confirmed ${clockLabel(confirmedAt)}. Simulated sighting.`);
  }

  private moveWorkZones(dtSec: number): void {
    for (const z of this.zones.values()) {
      const work = z.meta?.work;
      if (!work) continue;
      const next = stepAlong(work.line, work.meters, work.direction, work.speedMps * dtSec);
      work.meters = next.meters;
      work.direction = next.direction;
      const at = pointAlong(work.line, work.meters);
      const cell = this.cellAt(at.lonlat);
      if (cell !== z.centerCell) { z.centerCell = cell; z.geometry = circleZone(this.h.grid, cell, z.radiusM); }
      z.movingTowardDeg = work.direction === 1 ? at.bearing : (at.bearing + 180) % 360;
      z.movingSpeedMps = work.speedMps;
    }
  }

  private runSchedule(): void {
    if (!this.tuesdayOpen) return;
    const t = this.settings.tuesday;
    const day = this.dayStartMin();
    if (!this.gliderSilenced && this.simMin >= day + t.glider.silentHour * 60) {
      this.gliderSilenced = true;
      const c = this.spawn({ preset: 'glider', at: [t.glider.lon, t.glider.lat] });
      if (c) this.log('machine', 'Robot silent', `${c.spec.label} stopped reporting at ${clockLabel(this.simMin)}. Its drift forecast is the search area.`);
    }
    for (const plan of [...this.scheduled]) {
      if (this.simMin < plan.startMin) continue;
      this.scheduled = this.scheduled.filter((p) => p !== plan);
      this.openScheduledZone(plan.id, 'slow', 'Divers in water', plan.lonlat, plan.radiusM * 2, 'SLOW', { label: plan.label, filedBy: plan.filedBy, slowKnots: this.orders().speedAdvisoryKnots }, plan.startMin, plan.endMin);
      this.log('machine', 'Dive plan active', `${plan.label} started, filed by ${plan.filedBy}.`);
    }
  }

  reportSighting(e: { species: P.Species; lonlat: LonLat; note?: string }, source: P.Sighting['source'], reporter: string): P.Sighting {
    const sighting: P.Sighting = {
      id: this.id('s'), species: e.species, lonlat: e.lonlat, atMin: this.simMin, dayOffset: 0, whenLabel: '', source, reporter,
      status: source === 'desk' ? 'confirmed' : 'reported', simulated: false, note: (e.note ?? '').slice(0, 200),
    };
    this.sightings.unshift(sighting);
    const near = this.placeNear(this.cellAt(e.lonlat));
    this.log(source === 'desk' ? 'officer' : `captain:${reporter}`, 'Sighting reported', `${e.species.charAt(0).toUpperCase()}${e.species.slice(1)} near ${near}, from ${reporter}${sighting.note ? `: ${sighting.note}` : ''}`);
    if (source === 'desk') { if (e.species === 'whale') this.confirmSighting(sighting.id); return sighting; }
    this.raiseCard(`sighting:${sighting.id}`, {
      kind: e.species === 'whale' || e.species === 'dolphin' || e.species === 'sea lion' ? 'animal' : 'info',
      title: `${e.species.charAt(0).toUpperCase()}${e.species.slice(1)} reported by ${reporter}`,
      body: e.species === 'whale' ? `Reported near ${near}. Confirm it to draft a whale slow zone for boats nearby.` : `Reported near ${near}. Confirm it to add it to the sightings log for researchers.`,
      facts: [`${clockLabel(this.simMin)}`, sighting.note || 'No note'],
      actions: [{ id: 'confirmSighting', label: 'Confirm', primary: true }, { id: 'notNow', label: 'Not now' }],
      contactId: null, noticeId: null, draftId: null, script: null,
    });
    return sighting;
  }

  confirmSighting(id: string): void {
    const s = this.sightings.find((x) => x.id === id);
    if (!s) return;
    s.status = 'confirmed';
    this.removeCards((k) => k.key === `sighting:${id}`);
    this.log('officer', 'Sighting confirmed', `${s.species} from ${s.reporter}`);
    if (s.species !== 'whale') return;
    const o = this.orders();
    const draftId = this.upsertRoutineZone(`z-sighting-${id}`, 'slow', 'Whale nearby', this.cellAt(s.lonlat), o.animalSlowMeters, null, 'SLOW', `Whale reported by ${s.reporter}`, { label: `Whale, reported by ${s.reporter}`, filedBy: `Reported by ${s.reporter}, confirmed by the desk` });
    if (!draftId) return;
    this.raiseCard(`publish:${draftId}`, {
      kind: 'publish', title: 'Whale slow zone ready',
      body: `Boats within ${o.animalSlowMeters} m slow to ${o.animalSlowKnots} knots. It uses the routine template you signed.`,
      facts: [this.drafts.get(draftId)?.plan.comparison.chosen ?? '', `Reported by ${s.reporter}`],
      actions: [{ id: 'publish', label: 'Publish', primary: true }, { id: 'discard', label: 'Discard' }],
      contactId: null, noticeId: null, draftId, script: null,
    });
  }

  extendZone(noticeId: string, minutes: number): void {
    const n = this.notices.get(noticeId);
    if (!n || n.status !== 'active') return;
    n.expiresAtMin += Math.max(5, Math.min(480, minutes));
    n.validForMin = n.expiresAtMin - n.publishedAtMin;
    this.log('officer', 'Zone extended', `${n.label ?? n.publicReason} now until ${clockLabel(n.expiresAtMin)}`);
  }

  fileDivePlan(e: P.CommandEvents['fileDivePlan']): void {
    const day = this.dayStartMin();
    const cell = this.cellAt(e.lonlat);
    const plan: ScheduledZone = {
      id: this.id('dive'), label: `Dive, ${this.placeNear(cell).replace(/^the /, '')}`, filedBy: e.by.trim().slice(0, 60) || 'Dive team', cell, lonlat: e.lonlat,
      radiusM: e.radiusM ?? 100, startMin: day + e.startHour * 60, endMin: day + e.endHour * 60,
    };
    this.log('officer', 'Dive plan filed', `${plan.label}, ${clockLabel(plan.startMin)} to ${clockLabel(plan.endMin)}, by ${plan.filedBy}. Approved by ${this.officer}; it opens on time.`);
    if (plan.startMin <= this.simMin) {
      this.openScheduledZone(plan.id, 'slow', 'Divers in water', plan.lonlat, plan.radiusM * 2, 'SLOW', { label: plan.label, filedBy: plan.filedBy, slowKnots: this.orders().speedAdvisoryKnots }, this.simMin, plan.endMin);
      return;
    }
    this.scheduled.push(plan);
  }

  foundRobot(contactId: string): void {
    const c = this.contacts.get(contactId);
    if (!c) return;
    const z = this.zones.get(`z-${contactId}`);
    if (z?.noticeId) this.clearNotice(z.noticeId, 'officer', false, 'Found');
    if (z) this.removeZone(z.id);
    this.contacts.delete(contactId);
    this.forecasts.delete(contactId);
    this.removeCards((k) => k.contactId === contactId);
    this.log('officer', 'Found', `${c.spec.label} recovered by its owner. Search area lifted.`);
  }

  private aisZoneDelays(): Map<string, { addedMin: number; note: string }> {
    const out = new Map<string, { addedMin: number; note: string }>();
    for (const n of this.notices.values()) {
      if (n.status !== 'active' || n.kind !== 'whale') continue;
      const z = this.zones.get(n.zoneId);
      if (!z) continue;
      const knots = n.slowKnots;
      const minLength = this.settings.tuesday.whale.minLengthM;
      for (const v of this.ais) {
        if (v.sogKn <= knots || v.aisClass !== 'A' || (v.lengthM ?? 0) < minLength) continue;
        const route = this.aisProjectedRoute(v);
        let inside = 0;
        for (const cell of route) if (z.geometry.mask[cell]) inside++;
        if (!inside) continue;
        const meters = inside * this.h.grid.cellMeters;
        const added = (meters / (knots * KNOT_MPS) - meters / (v.sogKn * KNOT_MPS)) / 60;
        if (added < 0.1) continue;
        out.set(`ais-${v.mmsi}`, { addedMin: added, note: `+${Math.max(1, Math.round(added))} min from whale zone` });
      }
    }
    return out;
  }

  private todayRows(): P.TodayRow[] {
    const rows: P.TodayRow[] = [];
    for (const n of this.notices.values()) {
      if (n.status !== 'active') continue;
      const z = this.zones.get(n.zoneId);
      let relevant = 0;
      let acked = 0;
      let affected = 0;
      for (const [vid, e] of n.perVessel) {
        if (e.action !== 'none' || e.priority !== 'P4') affected++;
        const rec = this.deliveries.get(`${n.id}:${vid}`);
        if (!rec || (e.priority === 'P4' && e.action === 'none')) continue;
        relevant++;
        if (rec.states.acknowledged !== undefined) acked++;
      }
      rows.push({
        id: n.id, noticeId: n.id, label: n.label ?? `${n.publicReason} near ${this.placeNear(z?.centerCell ?? 0).replace(/^the /, '')}`,
        reason: n.publicReason, kind: n.kind, status: 'active',
        timesLabel: `${clockLabel(n.startsAtMin ?? n.publishedAtMin)} to ${clockLabel(n.expiresAtMin)}`,
        filedBy: n.filedBy ?? (n.routine ? `Approved by ${n.approvedBy}` : `Published by ${n.approvedBy}`), boatsAffected: affected,
        ackRate: relevant ? acked / relevant : null, simulated: !!n.simulated, lonlat: this.lonlatOf(z?.centerCell ?? 0),
      });
    }
    for (const p of this.scheduled) {
      rows.push({
        id: p.id, noticeId: null, label: p.label, reason: 'Divers in water', kind: 'divers', status: 'scheduled',
        timesLabel: `${clockLabel(p.startMin)} to ${clockLabel(p.endMin)}`, filedBy: p.filedBy, boatsAffected: 0, ackRate: null, simulated: false, lonlat: p.lonlat,
      });
    }
    return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
  }

  dailyReport(): P.DailyReport {
    const day = this.dayStartMin();
    const today = [...this.notices.values()].filter((n) => n.publishedAtMin >= day - 60);
    let notified = 0;
    let relevant = 0;
    let acked = 0;
    let delay = 0;
    const boats = new Set<string>();
    for (const n of today) {
      for (const [vid, e] of n.perVessel) {
        boats.add(vid);
        const rec = this.deliveries.get(`${n.id}:${vid}`);
        if (e.priority === 'P4' && e.action === 'none') continue;
        relevant++;
        if (rec?.states.acknowledged !== undefined) acked++;
        delay += e.addedMin;
      }
    }
    notified = boats.size;
    const whale = this.aisZoneDelays();
    let whaleShips = 0;
    let honored = 0;
    for (const n of today) {
      if (n.kind !== 'whale' || !n.largeShipsOnly) continue;
      const z = this.zones.get(n.zoneId);
      for (const v of this.ais) {
        if (v.aisClass !== 'A' || (v.lengthM ?? 0) < this.settings.tuesday.whale.minLengthM || !z || v.cell < 0 || !z.geometry.mask[v.cell] || v.sogKn < 0.5) continue;
        whaleShips++;
        if (v.sogKn <= n.slowKnots + 0.5) honored++;
      }
    }
    for (const w of whale.values()) delay += w.addedMin;
    const simulated = today.filter((n) => n.simulated).length;
    const label = this.night ? 'Tonight' : `Today, ${clockLabel(day)} to ${clockLabel(this.simMin)}`;
    return {
      dayLabel: label, zonesIssued: today.length, boatsNotified: notified, acknowledged: acked, ackRate: relevant ? acked / relevant : null,
      delayMinutes: Math.round(delay * 10) / 10, whaleShips, whaleHonored: honored, sightings: this.sightings.filter((x) => x.dayOffset === 0).length,
      simulatedShare: today.length ? simulated / today.length : 0,
      lines: [
        `${today.length} zone${today.length === 1 ? '' : 's'} issued, ${simulated} from the simulated schedule.`,
        `${notified} boats notified; ${acked} of ${relevant} that had to act acknowledged.`,
        `${(Math.round(delay * 10) / 10).toFixed(1)} minutes of delay caused in total.`,
        whaleShips ? `${honored} of ${whaleShips} large ships in the whale zone at or under ${this.settings.tuesday.whale.slowKnots} kn right now (AIS).` : 'No large ships in a whale zone right now.',
      ],
    };
  }

  private withZoneDelays(rows: P.OnTimeRow[]): P.OnTimeRow[] {
    const delays = this.aisZoneDelays();
    if (!delays.size) return rows;
    return rows.map((r) => {
      const d = delays.get(r.id);
      if (!d) return r;
      return { ...r, deltaMin: Math.round(((r.deltaMin ?? 0) + d.addedMin) * 10) / 10, zoneNote: d.note, status: r.status === 'on time' && d.addedMin >= this.settings.ais.onTimeLateMinutes ? 'at risk' : r.status };
    });
  }

  private focusContact(): ContactSim | null {
    let best: ContactSim | null = null;
    for (const c of this.contacts.values()) {
      if (!c.classification.threatScored || c.spec.reply === 'friendly' || c.classification.kind === 'debris') continue;
      if (!best || (c.lastRisk?.R ?? 0) > (best.lastRisk?.R ?? 0)) best = c;
    }
    return best;
  }

  private contactNoun(c: ContactSim): string {
    return c.classification.kind === 'powered' ? 'drone' : 'contact';
  }

  private securityStatus(c: ContactSim): { draft: DraftRec | null; notice: NoticeRec | null; boats: number; acked: number; silent: string[] } {
    const z = this.zones.get(`z-${c.id}`);
    const draft = z?.draftId ? this.drafts.get(z.draftId) ?? null : null;
    const notice = z?.noticeId ? this.notices.get(z.noticeId) ?? null : null;
    let boats = 0;
    let acked = 0;
    const silent: string[] = [];
    if (notice && notice.status === 'active') {
      for (const [vid, e] of notice.perVessel) {
        if (e.action === 'none' && e.priority === 'P4') continue;
        if (vid.startsWith('ais-')) continue;
        boats++;
        const rec = this.deliveries.get(`${notice.id}:${vid}`);
        if (rec?.states.acknowledged !== undefined) acked++;
        if (rec?.notResponding) silent.push(rec.vesselName);
      }
    } else if (draft) {
      boats = draft.plan.boats.filter((b) => !b.vesselId.startsWith('ais-')).length;
    }
    return { draft, notice: notice && notice.status === 'active' ? notice : null, boats, acked, silent };
  }

  headline(): P.Headline {
    const silentCard = this.cards.find((k) => k.kind === 'notResponding');
    if (silentCard) {
      const rec = [...this.deliveries.values()].find((d) => d.notResponding && silentCard.key.endsWith(`:${d.vesselId}`));
      const waited = rec ? Math.round(this.simMin - (rec.urgentSinceMin ?? rec.states.sent ?? this.simMin)) : this.settings.delivery.vhfCardMinutes;
      return { text: `${silentCard.title.replace(/ not responding$/, '')} has not answered for ${waited} minutes. Call it on VHF.`, tone: 'alert', contactId: silentCard.contactId };
    }
    const c = this.focusContact();
    if (c) {
      const noun = this.contactNoun(c);
      const place = this.placeNear(c.cell).replace(/^the /, 'the ');
      const fs = this.forecastSummary(c);
      const st = this.securityStatus(c);
      const confident = fs && fs.topName && fs.topP >= this.orders().draftOddsMin;
      const update = this.cards.find((k) => k.kind === 'update' && k.contactId === c.id);
      if (update) return { text: `${update.title.replace(/^Forecast update: now /, `The ${noun} now heads for `)}. Publish the forecast update so captains see it.`, tone: 'act', contactId: c.id };
      if (!confident || !fs) return { text: `Unknown ${noun} at ${place.charAt(0).toUpperCase()}${place.slice(1)}. Not sure where it is going yet. Watching.`, tone: 'watch', contactId: c.id };
      const arrive = fs.arrival ? `, arrives ${fs.arrival.earlyLabel}` : '';
      const head = `Unknown ${noun} heading to the ${fs.topName} (${Math.round(fs.topP * 100)}%)${arrive}.`;
      if (st.notice) {
        const tail = st.boats ? `${st.boats} boat${st.boats === 1 ? '' : 's'} warned, ${st.acked} acknowledged.` : 'Notice out; no boat is in its path.';
        return { text: `${head} ${tail}`, tone: st.acked < st.boats ? 'act' : 'watch', contactId: c.id };
      }
      if (st.draft) return { text: `${head} ${st.boats} boat${st.boats === 1 ? '' : 's'} cross its path. Notice ready to publish.`, tone: 'act', contactId: c.id };
      return { text: `${head} No boat crosses its path. Watching.`, tone: 'watch', contactId: c.id };
    }
    const lost = this.cards.find((k) => k.kind === 'lost');
    if (lost && lost.contactId) {
      const g = this.contacts.get(lost.contactId);
      if (g) return { text: `${g.spec.label} stopped reporting. Its drift forecast is the search area.`, tone: 'watch', contactId: g.id };
    }
    const active = [...this.notices.values()].filter((n) => n.status === 'active');
    const notified = new Set<string>();
    for (const n of active) for (const [vid, e] of n.perVessel) if (e.priority !== 'P4' || e.action !== 'none') notified.add(vid);
    const rows = this.onTimeRows();
    const behind = rows.filter((r) => r.status === 'late' || r.status === 'at risk').length;
    const day = this.night ? 'Night watch' : 'Tuesday';
    const zones = active.length ? `${active.length} zone${active.length === 1 ? '' : 's'} active, ${notified.size} boat${notified.size === 1 ? '' : 's'} notified` : 'Harbor quiet, no zones';
    const onTime = behind ? `${behind} boat${behind === 1 ? '' : 's'} running late` : 'all ships on time';
    return { text: `${day} ${clockLabel(this.simMin)}. ${zones}, ${onTime}.`, tone: 'calm', contactId: null };
  }

  steps(): P.StepView[] | null {
    const c = this.focusContact();
    if (!c) return null;
    const fs = this.forecastSummary(c);
    const st = this.securityStatus(c);
    const risk = c.lastRisk;
    const confident = !!fs?.topName && (fs?.topP ?? 0) >= this.orders().draftOddsMin;
    const steps: P.StepView[] = [
      { key: 'detect', label: 'Detect', fact: `Unknown ${this.contactNoun(c)}, ${clockLabel(c.spec.firstSeenMin)}`, reached: true, current: false },
      { key: 'predict', label: 'Predict', fact: fs?.topName ? `${fs.topName} ${Math.round(fs.topP * 100)}%` : 'Learning', reached: confident, current: false },
      { key: 'assess', label: 'Assess', fact: risk ? `${risk.levelName}` : null, reached: !!risk, current: false },
      { key: 'warn', label: 'Warn', fact: st.notice ? `${st.boats} boat${st.boats === 1 ? '' : 's'}, ${st.acked} acknowledged` : st.draft ? `${st.boats} boat${st.boats === 1 ? '' : 's'}, ready` : null, reached: !!st.notice, current: false },
      { key: 'confirm', label: 'Confirm', fact: st.silent.length ? `${st.silent[0]} no reply` : st.notice && st.boats ? `${st.acked} of ${st.boats}` : null, reached: !!st.notice && st.boats > 0 && st.acked >= st.boats, current: false },
    ];
    const currentKey: P.StepKey = st.silent.length || st.notice ? 'confirm' : st.draft ? 'warn' : risk && confident ? 'assess' : fs ? 'predict' : 'detect';
    for (const step of steps) step.current = step.key === currentKey;
    return steps;
  }

  private sightingViews(): P.Sighting[] {
    const day = this.dayStartMin();
    return this.sightings.slice(0, 200).map((x) => {
      const offset = Math.floor((x.atMin - day) / 1440);
      const when = offset === 0 ? clockLabel(x.atMin) : offset === -1 ? `Yesterday ${clockLabel(x.atMin)}` : `${-offset} days ago`;
      return { ...x, dayOffset: offset, whenLabel: when };
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
    this.updateAisShown();
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
      const before = this.forecasts.get(c.id)?.version;
      const rec = this.updateForecast(c);
      if (stepped || t - last >= 0.5 || (rec && rec.version !== before)) { this.lastResponseMin.set(c.id, t); this.respondTo(c); }
    }
    for (const id of [...this.forecasts.keys()]) if (!this.contacts.has(id)) this.forecasts.delete(id);
    for (const craft of this.craft) moveCraft(this.h, craft, dtSec, t, null);
    this.moveWorkZones(dtSec);
    this.runSchedule();
    this.updateNotices();
    this.updateCards();
    const showMs = this.settings.sim.allClearShowSeconds * 1000;
    this.allClearRecent = this.allClearRecent.filter((a) => wallMs - Date.parse(a.atWall) < showMs);
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
    if (c.spec.registryId && kind === 'debris') return this.respondToLostRobot(c);
    const risk = c.lastRisk;
    const zoneId = `z-${c.id}`;
    const existing = this.zones.get(zoneId);
    if (!risk || risk.level < SERIOUS || c.spec.reply === 'friendly') {
      if (existing && existing.status === 'draft') { this.zones.delete(zoneId); this.dropDraftFor(zoneId); }
      return;
    }
    if (!existing && this.stillDismissed(zoneId, risk.level)) return;
    const o = this.orders();
    const top = topGoal(c.tell);
    const rec = this.forecasts.get(c.id) ?? this.updateForecast(c, true);
    if (!rec) return;
    const draft = existing?.draftId ? this.drafts.get(existing.draftId) : undefined;
    const activeNotice = existing?.noticeId ? this.notices.get(existing.noticeId) : undefined;
    const zoneMeters = draft?.officerRadius ?? (activeNotice?.status === 'active' ? activeNotice.radiusM : o.zoneMeters);
    const fresh = this.areaFor(c, rec, zoneMeters);
    const zone: ZoneRec = existing ?? {
      id: zoneId, kind: 'keepOut', reason: 'Security zone', status: 'draft', geometry: this.areaGeometry(fresh), radiusM: zoneMeters, contactId: c.id, noticeId: null, draftId: null,
      movingTowardDeg: c.headingDeg, movingSpeedMps: c.spec.speedMps, centerCell: c.cell, area: fresh, changedAtMin: null, pendingArea: null,
    };
    zone.movingTowardDeg = c.headingDeg;
    zone.movingSpeedMps = c.silent ? 0 : c.spec.speedMps;
    let plan: ResponsePlan;
    if (zone.status === 'published' && zone.noticeId) {
      plan = this.securityPlan(zone.area ?? fresh);
      const n = this.notices.get(zone.noticeId);
      if (n) { n.responsePlan = plan; n.plan = this.planView(plan, n.radiusM, n.slowKnots); }
      this.checkForecastUpdate(c, zone, fresh, top.p >= o.draftOddsMin);
    } else {
      zone.area = fresh;
      zone.geometry = this.areaGeometry(fresh);
      zone.radiusM = zoneMeters;
      zone.centerCell = c.cell;
      plan = this.securityPlan(fresh);
      const crossing = plan.affected.length > 0;
      const meetsOrders = risk.R >= o.draftRiskMin && top.goal >= 0 && top.p >= o.draftOddsMin && crossing;
      if (meetsOrders || zone.draftId) {
        this.zones.set(zoneId, zone);
        this.upsertSecurityDraft(c, zone, plan, risk.level);
      }
    }
    const targetName = top.goal >= 0 ? (this.h.targets[top.goal].short ?? this.h.targets[top.goal].name) : null;
    const confident = top.goal >= 0 && top.p >= o.draftOddsMin;
    if (risk.level < HIGH || !confident) this.removeCards((k) => k.key.startsWith(`hold:${c.id}:`));
    if (risk.level >= HIGH && confident) {
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
    const searchOut = this.zones.get(`z-${c.id}`)?.status === 'published';
    this.raiseCard(key, {
      kind: 'lost', title: searchOut ? 'Search area published' : 'Lost, not hostile',
      body: `${reg.name} stopped reporting. It is drifting with the current, not aiming. It was heading back to its dock at the ${home?.short ?? 'home berth'}.${searchOut ? ' Boats keep clear of the search area. Close it when the owner has it back.' : ''}`,
      facts: [`Owner: ${reg.owner}, message ready`, `Drift ${mpsToKnots(c.spec.speedMps).toFixed(1)} kn toward ${compassPoint(c.headingDeg)}`, searchOut ? 'Search area published from the drift forecast' : 'Search area drafted from the drift forecast'],
      actions: searchOut ? [{ id: 'found', label: 'Found', primary: true }, { id: 'ok', label: 'OK' }] : [{ id: 'publishZone', label: 'Publish search area', primary: true }, { id: 'found', label: 'Found' }],
      contactId: c.id, noticeId: null, draftId: null,
      script: `${reg.owner}, this is ${this.station}. ${reg.name} stopped reporting at ${clockLabel(c.spec.firstSeenMin)} near ${this.placeNear(c.cell)}. It is drifting with the current toward the ${compassPoint(c.headingDeg)} at about ${mpsToKnots(c.spec.speedMps).toFixed(1)} kn. The search area for the next hour is on the harbor chart. Please call us when it is recovered.`,
    });
    const zoneId = `z-${c.id}`;
    if (this.stillDismissed(zoneId, null)) return;
    const rec = this.forecasts.get(c.id) ?? this.updateForecast(c, true);
    if (!rec) return;
    const f = this.settings.forecast;
    const existing = this.zones.get(zoneId);
    if (existing?.status === 'published') return;
    const areaKey = `${rec.version}|search`;
    const a: AreaRec = existing?.area?.key === areaKey ? existing.area : (() => {
      const area = buildNoticeArea(this.h.grid, rec.forecast, rec.cell, Math.max(0.05, this.currentSpeedMps), { horizonMinutes: f.horizonMinutes, zoneMeters: 150, carefulShare: f.carefulShare, exitMinutesMax: f.exitMinutesMax }, rec.madeAtMin);
      return { area, shapes: noticeAreaShapes(this.h.grid, area), ticks: rec.ticks, version: ++this.areaSeq, key: areaKey };
    })();
    this.upsertAreaZone(zoneId, 'Search area', a, c.id, `Search area: ${reg.name}`, { label: `Search area, ${reg.name}`, filedBy: `${reg.owner}, notified` });
  }

  private respondToAnimal(c: ContactSim): void {
    const key = `animal:${c.id}`;
    if (!this.marineLog.some((m) => m.id === key)) {
      this.marineLog.push({ id: key, atMin: this.simMin, lonlat: contactLonLat(this.h, c), kind: 'Marine animal', detail: `${c.spec.sizeM.toFixed(0)} m, warm, erratic, surfacing near ${this.placeNear(c.cell)}` });
      this.log('machine', 'Marine-life log', `Animal logged near ${this.placeNear(c.cell)}`);
    }
    const o = this.orders();
    if (this.stillDismissed(`z-${c.id}`, null)) return;
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
    const draftId = this.stillDismissed(`z-${c.id}`, null) ? null : this.upsertRoutineZone(`z-${c.id}`, 'keepOut', 'Person in the water', c.cell, 200, c.id, 'KEEP CLEAR', null);
    this.raiseCard(key, {
      kind: 'person', title: 'Person in the water: hand off',
      body: `A warm body about ${c.spec.sizeM.toFixed(1)} m moving slowly near ${this.placeNear(c.cell)}. Boats are routed away. Port police brief is ready. People are never scored as targets.`,
      facts: [`Near ${this.placeNear(c.cell)}`, `${c.spec.speedMps.toFixed(1)} m/s`],
      actions: [{ id: 'send', label: 'Send port police brief', primary: true }, { id: 'publish', label: 'Publish keep-clear zone' }],
      contactId: c.id, noticeId: null, draftId, script: `Port police, this is ${this.station}. Possible person in the water near ${this.placeNear(c.cell)}. Boats are being routed away. Request a unit to check.`,
    });
  }

  private noticeKindFor(reason: P.PublicReason): P.NoticeKind {
    switch (reason) {
      case 'Whale nearby': return 'whale';
      case 'Divers in water': return 'divers';
      case 'Person in the water': return 'person';
      case 'Area closed': return 'closure';
      case 'Search area': return 'search';
      case 'Security zone': return 'security';
      default: return 'dredge';
    }
  }

  private routinePlan(zone: ZoneRec): ResponsePlan {
    return zone.kind === 'slow'
      ? this.slowPlan(zone.geometry.mask, zone.centerCell, zone.radiusM, zone.meta?.slowKnots, !!zone.meta?.largeShipsOnly)
      : chooseResponse(this.h.grid, zone.geometry.mask, this.boats(), this.h.places.map((p) => ({ id: p.id, name: p.name, cell: p.cell })), this.responseRules(0, true), null);
  }

  private upsertRoutineZone(zoneId: string, kind: 'keepOut' | 'slow', reason: P.PublicReason, cell: number, radiusM: number, contactId: string | null, instruction: Instruction, label: string | null, meta?: ZoneMeta): string | null {
    const existing = this.zones.get(zoneId);
    if (existing?.status === 'published') {
      existing.geometry = circleZone(this.h.grid, cell, existing.radiusM);
      existing.centerCell = cell;
      return existing.draftId;
    }
    const draft = existing?.draftId ? this.drafts.get(existing.draftId) : undefined;
    const r = draft?.officerRadius ?? radiusM;
    const geometry = circleZone(this.h.grid, cell, r);
    const zone: ZoneRec = existing ?? { id: zoneId, kind, reason, status: 'draft', geometry, radiusM: r, contactId, noticeId: null, draftId: null, movingTowardDeg: null, movingSpeedMps: 0, centerCell: cell, meta };
    zone.geometry = geometry;
    zone.radiusM = r;
    zone.centerCell = cell;
    if (meta) zone.meta = { ...zone.meta, ...meta };
    this.zones.set(zoneId, zone);
    return this.upsertDraft(zone, this.routinePlan(zone), this.noticeKindFor(reason), instruction, true, null, label);
  }

  private upsertAreaZone(zoneId: string, reason: P.PublicReason, a: AreaRec, contactId: string | null, label: string, meta?: ZoneMeta): string | null {
    const existing = this.zones.get(zoneId);
    if (existing?.status === 'published') return existing.draftId;
    const geometry = this.areaGeometry(a);
    const zone: ZoneRec = existing ?? { id: zoneId, kind: 'keepOut', reason, status: 'draft', geometry, radiusM: 150, contactId, noticeId: null, draftId: null, movingTowardDeg: null, movingSpeedMps: 0, centerCell: a.area.contactCell, area: a, meta };
    zone.geometry = geometry;
    zone.area = a;
    zone.centerCell = a.area.contactCell;
    if (meta) zone.meta = { ...zone.meta, ...meta };
    this.zones.set(zoneId, zone);
    const plan = chooseResponse(this.h.grid, geometry.mask, this.boats(), this.h.places.map((p) => ({ id: p.id, name: p.name, cell: p.cell })), this.responseRules(0, true), null);
    return this.upsertDraft(zone, plan, this.noticeKindFor(reason), 'KEEP CLEAR', true, null, label);
  }

  private slowPlan(mask: Uint8Array, centerCell: number | null = null, radiusM = 0, slowKnots?: number, largeShipsOnly = false): ResponsePlan {
    const o = this.orders();
    const pr = this.settings.priority;
    const slowMps = (slowKnots ?? o.animalSlowKnots) * KNOT_MPS;
    const core = centerCell !== null && radiusM > 0 ? circleZone(this.h.grid, centerCell, radiusM * o.animalCoreFraction).mask : null;
    const everyone = this.boats().map((b) => {
      const onRoute = !largeShipsOnly && routeEntersMask(b.route, mask);
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
        vesselId: a.id, name: a.name, priority: a.priority, instruction: a.text ?? instructionText(a.instruction, radiusM, slowKnots),
        addedMin: a.addedMin, action: a.action, minutesToZone: a.minutesToZone, simulated: !craftById.get(a.id)?.phone,
        crossingLabel: a.crossing ? `${clockLabel(this.simMin + a.crossing.boatMin)}` : null,
        untilLabel: a.untilMin !== undefined && a.untilMin !== null ? clockLabel(this.simMin + a.untilMin) : null,
        noGentle: !!a.noGentle,
        options: (a.options ?? []).map((op) => ({ kind: op.kind, label: FIX_LABEL[op.kind], addedMin: op.feasible ? Math.round(op.addedMin * 10) / 10 : null, why: op.why })),
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
    const stuck = plan.affected.filter((a) => a.noGentle).map((a) => a.name);
    const actions: P.CardAction[] = [{ id: 'publish', label: 'Publish', primary: true }, { id: 'discard', label: 'Discard' }];
    if (stuck.length) actions.splice(1, 0, { id: 'send', label: 'Hand off' });
    this.raiseCard(`publish:${draftId}`, {
      kind: 'publish', title: stuck.length ? `No gentle option for ${stuck.join(' and ')}` : 'Give-way notice drafted',
      body: d.wording.why,
      facts: [plan.comparison.chosen, plan.comparison.closeHarbor, `Risk ${c.lastRisk?.R ?? ''} ${levelName(level)}`],
      actions,
      contactId: c.id, noticeId: null, draftId, script: stuck.length ? templateWording(this.wordingFacts(c, zone, plan, d)).brief : null,
    });
  }

  private upsertDraft(zone: ZoneRec, plan: ResponsePlan, kind: P.NoticeKind, instruction: Instruction, routine: boolean, c: ContactSim | null, label: string | null): string | null {
    const o = this.orders();
    let d = zone.draftId ? this.drafts.get(zone.draftId) : undefined;
    const slowKnots = zone.meta?.slowKnots ?? (kind === 'whale' ? o.animalSlowKnots : o.speedAdvisoryKnots);
    if (!d) {
      const id = this.id('d');
      d = {
        id, kind, contactId: c?.id ?? zone.contactId, zoneId: zone.id, instruction, instructionText: '', radiusM: zone.radiusM, slowKnots,
        recipients: 'all', named: [], publicReason: zone.reason, validForMin: routine ? o.routineValidMinutes : o.noticeValidMinutes, approvedBy: this.officer,
        plan: this.planView(plan, zone.radiusM, slowKnots), wording: templateWording(this.blankFacts(zone)), createdAtMin: this.simMin, updatedAtMin: this.simMin,
        edited: false, routine, responsePlan: plan, wordingKey: '', factsKey: '', wordingInFlight: false, officerRadius: null, officerInstruction: null,
      };
      d.label = zone.meta?.label ?? null;
      d.filedBy = zone.meta?.filedBy ?? null;
      d.largeShipsOnly = !!zone.meta?.largeShipsOnly;
      d.simulated = !!zone.meta?.simulated;
      d.startsAtMin = zone.meta?.startsAtMin ?? null;
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
      slowKnots: 5, nearPlace: this.placeNear(zone.centerCell), validUntilMin: this.simMin + this.orders().noticeValidMinutes, approvedBy: this.officer, boats: [], totalAddedMin: 0,
      station: this.station, link: this.link,
    };
  }

  private wordingFacts(c: ContactSim | null, zone: ZoneRec, plan: ResponsePlan, d: DraftRec | null): WordingFacts {
    const instruction = d?.instruction ?? 'KEEP CLEAR';
    const radiusM = d?.radiusM ?? zone.radiusM;
    const slowKnots = d?.slowKnots ?? this.orders().speedAdvisoryKnots;
    const facts: WordingFacts = {
      kind: d?.kind ?? 'security', instruction, instructionText: instructionText(instruction as Instruction, radiusM, slowKnots), publicReason: d?.publicReason ?? zone.reason,
      radiusM, slowKnots, nearPlace: this.placeNear(zone.centerCell), validUntilMin: this.simMin + (d?.validForMin ?? this.orders().noticeValidMinutes), approvedBy: this.officer,
      boats: plan.affected.map((a) => ({ name: a.name, instructionText: a.text ?? instructionText(a.instruction, radiusM, slowKnots), addedMin: a.addedMin })),
      totalAddedMin: plan.totalAddedMin, station: this.station, link: this.link,
    };
    if (c && c.lastRisk && c.hostility) {
      const top = topGoal(c.tell);
      const tgt = top.goal >= 0 ? this.h.targets[top.goal] : null;
      const ll = contactLonLat(this.h, c);
      facts.contact = {
        label: c.spec.label, classification: c.classification.label, sizeM: c.spec.sizeM, speedMps: c.spec.speedMps, hostility: c.hostility.H,
        evidence: c.hostility.items.filter((i) => i.key !== 'start').map((i) => i.label.charAt(0).toLowerCase() + i.label.slice(1)),
        targetName: tgt?.short ?? tgt?.name ?? 'no clear target', odds: top.p, etaMin: top.goal >= 0 ? etaToGoal(this.h, c, top.goal) : null,
        riskScore: c.lastRisk.R, level: c.lastRisk.levelName, damage: damagePhrase(tgt?.kind ?? ''),
        lonlatText: `${Math.abs(ll[1]).toFixed(4)} N ${Math.abs(ll[0]).toFixed(4)} W`,
      };
    }
    return facts;
  }

  private stopDrafting(z: ZoneRec): void {
    if (!z.contactId) return;
    this.dismissed.add(`zone:${z.id}`);
    const level = this.contacts.get(z.contactId)?.lastRisk?.level;
    if (level !== undefined) this.discardedAtLevel.set(z.id, level);
  }

  private stillDismissed(zoneId: string, level: number | null): boolean {
    if (!this.dismissed.has(`zone:${zoneId}`)) return false;
    const at = this.discardedAtLevel.get(zoneId);
    if (level === null || at === undefined || level <= at) return true;
    this.dismissed.delete(`zone:${zoneId}`);
    this.discardedAtLevel.delete(zoneId);
    return false;
  }

  private dropDraftFor(zoneId: string): void {
    for (const d of this.drafts.values()) if (d.zoneId === zoneId) { this.drafts.delete(d.id); this.removeCards((k) => k.draftId === d.id); }
  }

  discardDraft(draftId: string, actor = 'officer'): void {
    const d = this.drafts.get(draftId);
    if (!d) return;
    this.drafts.delete(draftId);
    const z = this.zones.get(d.zoneId);
    if (z && z.status === 'draft') { this.zones.delete(z.id); this.stopDrafting(z); }
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
        this.upsertDraft(z, this.routinePlan(z), d.kind, (d.officerInstruction ?? d.instruction) as Instruction, d.routine, null, null);
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
    if (e.kind === 'closure') {
      const id = this.upsertRoutineZone(zoneId, 'keepOut', 'Area closed', cell, e.radiusM ?? o.routineZoneMeters, null, 'KEEP CLEAR', 'Closure', { label: `Closure near ${this.placeNear(cell).replace(/^the /, '')}` });
      this.attachUndoToLast(() => this.removeZone(zoneId));
      return id;
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

  publish(draftId: string, actor = 'officer'): string | null {
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
    this.log(actor, 'Published', `${d.publicReason}: ${d.instructionText}. ${notice.perVessel.size} recipients. ${plan?.comparison.chosen ?? ''}`, () => this.clearNotice(id, 'officer', true, 'All clear', false));
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

  private refreshSecurityNotice(n: NoticeRec, a: AreaRec): void {
    const rules = this.plannerRules();
    const t = this.simMin;
    for (const r of this.recipientsFor(n)) {
      const prev = n.perVessel.get(r.id);
      const rec = this.deliveries.get(`${n.id}:${r.id}`);
      const acknowledged = rec?.states.acknowledged !== undefined;
      let entry: VesselPlanEntry;
      if (r.craft && prev && acknowledged && r.craft.rerouteNoticeId === n.id) {
        entry = prev;
      } else {
        const boat = r.craft ? this.plannerBoat(r.craft) : this.aisPlannerBoat(r.ais as AisInputVessel & { cell: number });
        const crossing = boatCrossing(this.h.grid, a.area, boat, t, rules.padMinutes);
        let priority = priorityForCrossing(crossing, rules);
        if (prev && !acknowledged) priority = moreUrgent(prev.priority, priority);
        const sameArea = prev?.fixAreaVersion === a.version;
        let fix = sameArea ? prev?.fix ?? null : null;
        let fixAtMin = sameArea ? prev?.fixAtMin ?? t : t;
        let noGentle = sameArea ? !!prev?.noGentle : false;
        const urgent = priority === 'P1' || priority === 'P2';
        const retry = !sameArea || (noGentle && t - fixAtMin >= 1);
        if (crossing && crossing.layer === 'likely' && urgent && boat.movable && !fix && retry) {
          const bp = planBoat(this.h.grid, a.area, boat, t, rules);
          fix = bp.fix;
          fixAtMin = t;
          noGentle = bp.noGentleOption;
        }
        const action = fix ? fix.kind : crossing || (prev && prev.action !== 'none') ? 'headsUp' : 'none';
        const text = fix ? fixInstruction(fix, fix.kind) : action === 'headsUp' ? (urgent ? 'KEEP CLEAR AND STAND BY' : 'NO ACTION NEEDED YET') : n.instructionText;
        const crossingAbs = crossing
          ? { layer: crossing.layer, atMin: t + crossing.boatMin, droneEarlyMin: t + crossing.droneEarlyMin, droneLateMin: t + crossing.droneLateMin }
          : prev?.crossing ?? null;
        entry = {
          priority, instruction: 'KEEP CLEAR', instructionText: text, addedMin: fix?.addedMin ?? 0, minutesToZone: crossing?.boatMin ?? null, action,
          newRoute: fix && (fix.kind === 'reroute' || fix.kind === 'stepAside') ? fix.cells : null,
          untilMin: fix && fix.untilMin !== null ? fixAtMin + fix.untilMin : crossingAbs ? crossingAbs.droneLateMin + rules.padMinutes : null,
          crossing: crossingAbs, fix, fixAtMin, fixAreaVersion: a.version, noGentle,
        };
      }
      n.perVessel.set(r.id, entry);
      const key = `${n.id}:${r.id}`;
      if (!this.deliveries.has(key)) this.createDelivery(n, r, entry);
      else this.updateDeliveryPriority(this.deliveries.get(key)!, r.craft, entry);
    }
  }

  private applyFix(n: NoticeRec, craft: CraftSim, entry: VesselPlanEntry, actor: string): void {
    if (craft.ignoresNotices) return;
    const a = this.zones.get(n.zoneId)?.area;
    if (!a) return;
    const t = this.simMin;
    const fresh = planBoat(this.h.grid, a.area, this.plannerBoat(craft), t, this.plannerRules());
    const fix = (entry.fix ? fresh.options.find((o) => o.kind === entry.fix?.kind && o.feasible) : undefined) ?? fresh.fix;
    if (!fix) return;
    craft.rerouteNoticeId = n.id;
    craft.addedMin = fix.addedMin;
    const until = fix.untilMin !== null ? t + fix.untilMin : null;
    if (fix.kind === 'hold') {
      if (craft.dwellUntilMin !== null) craft.dwellUntilMin = Math.max(craft.dwellUntilMin, until ?? t);
      else { craft.waitAtIdx = craft.routeIdx; craft.waitUntilMin = until; }
    } else if (fix.kind === 'slow') {
      craft.slowMps = (fix.slowKnots ?? this.settings.forecast.minSlowKnots) * KNOT_MPS;
      craft.slowUntilMin = until;
    } else if (fix.cells) {
      const aside = fix.kind === 'stepAside' ? fix.cells[fix.waitIndex] : -1;
      applyRoute(this.h, craft, fix.cells, n.id, fix.addedMin);
      if (fix.kind === 'stepAside') { craft.waitAtIdx = craft.route.indexOf(aside); craft.waitUntilMin = until; }
    }
    entry.fix = fix;
    entry.fixAtMin = t;
    entry.action = fix.kind;
    entry.instructionText = fixInstruction(fix, fix.kind);
    entry.untilMin = until ?? entry.untilMin ?? null;
    entry.addedMin = fix.addedMin;
    entry.newRoute = fix.kind === 'reroute' || fix.kind === 'stepAside' ? fix.cells : null;
    if (actor !== 'simulated') this.log(actor, 'Giving way', `${craft.name}: ${entry.instructionText}${entry.untilMin ? ` until ${clockLabel(entry.untilMin)}` : ''} (${signedMinutes(fix.addedMin)})`);
  }

  private refreshNotice(n: NoticeRec): void {
    const z = this.zones.get(n.zoneId);
    if (!z) return;
    if (n.kind === 'security' && z.area) { this.refreshSecurityNotice(n, z.area); return; }
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
    if ((entry.priority === 'P1' || entry.priority === 'P2') && rec.urgentSinceMin === null) rec.urgentSinceMin = this.simMin;
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
      urgentSinceMin: entry.priority === 'P1' || entry.priority === 'P2' ? t : null,
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
    if (isPhone) this.queueAlertPush(n, r.id, entry);
  }

  private queueAlertPush(n: NoticeRec, vesselId: string, entry: VesselPlanEntry): void {
    if (entry.priority !== 'P1' && entry.priority !== 'P2') return;
    this.effects.pushes.push({
      vesselId, priority: entry.priority, tag: n.id, url: `/captain?notice=${n.id}`,
      title: entry.priority === 'P1' ? `ACT NOW: ${entry.instructionText}` : `Act soon: ${entry.instructionText}`,
      body: `${n.publicReason} near ${this.placeNear(this.zones.get(n.zoneId)?.centerCell ?? 0)}. Tap for the map.`,
    });
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
          const givingWay = n.kind === 'security' && entry.fixAreaVersion !== undefined && (craft.rerouteNoticeId === n.id || !entry.fix);
          const avoiding = givingWay || (!inside && (!mask || !routeEntersMask(remainingRoute(craft), mask) || craft.held || entry.action === 'slow'));
          if (avoiding) rec.states.complying = t;
        }
        if (!craft && rec.states.complying === undefined) {
          const v = this.ais.find((a) => `ais-${a.mmsi}` === vid);
          if (v && mask && mask[v.cell] !== 1 && entry.minutesToZone === null) rec.states.complying = t;
        }
        const relevant = entry.priority === 'P1' || entry.priority === 'P2';
        if (craft && relevant && rec.states.acknowledged === undefined) {
          const waited = t - (rec.urgentSinceMin ?? rec.states.sent ?? t);
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
    if (n.kind === 'security' && entry.fixAreaVersion !== undefined) {
      if (entry.fix) this.applyFix(n, craft, entry, actor);
      return;
    }
    if (entry.action === 'wait') { craft.held = true; return; }
    if ((entry.action === 'reroute' || entry.action === 'leave') && entry.newRoute && craft.rerouteNoticeId !== n.id && !craft.ignoresNotices) {
      const z = this.zones.get(n.zoneId);
      const fresh = z && z.kind === 'keepOut' ? rerouteAround(this.h.grid, remainingRoute(craft), z.geometry.mask, craft.speedMps) : null;
      const cells = fresh && fresh.status !== 'clear' && fresh.status !== 'noPath' && fresh.status !== 'destinationInZone' ? fresh.cells : entry.newRoute;
      applyRoute(this.h, craft, cells, n.id, fresh?.addedMin ?? entry.addedMin);
      if (actor !== 'simulated') this.log(actor, 'Route changed', `${craft.name} follows the new route (${signedMinutes(craft.addedMin)})`);
    }
  }

  clearNotice(noticeId: string, actor: string, logIt = true, reason = 'All clear', keepClear = actor === 'officer'): void {
    const n = this.notices.get(noticeId);
    if (!n || n.status !== 'active') return;
    n.status = reason === 'Expired' ? 'expired' : 'cleared';
    const z = this.zones.get(n.zoneId);
    if (z) { this.zones.delete(z.id); if (keepClear) this.stopDrafting(z); }
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
    if (existing) { existing.body = card.body; existing.facts = card.facts; existing.script = card.kind === 'publish' ? card.script : card.script ?? existing.script; existing.title = card.title; existing.actions = card.actions; return; }
    this.cards.push({ ...card, id: this.id('card'), key, createdAtMin: this.simMin, realerts: 0, backupCalled: false, lastAlertMin: this.simMin, rank: CARD_RANK[card.kind], shownAtWall: this.wallMs, lastAlertWall: this.wallMs });
    this.cards.sort((a, b) => a.rank - b.rank || a.createdAtMin - b.createdAtMin);
    this.log('machine', 'Card raised', card.title);
  }

  private removeCards(pred: (k: CardRec) => boolean): void { this.cards = this.cards.filter((k) => !pred(k)); }

  private updateCards(): void {
    const o = this.orders();
    const top = this.cards[0];
    if (!top) return;
    const waitedMin = (this.wallMs - top.shownAtWall) / 60_000;
    if ((this.wallMs - top.lastAlertWall) / 60_000 >= o.realertMinutes) {
      top.realerts++;
      top.lastAlertWall = this.wallMs;
      this.log('machine', 'Re-alert', `${top.title} (no answer for ${Math.round(waitedMin)} min). It will not act on its own.`);
    }
    if (!top.backupCalled && waitedMin >= o.backupOfficerMinutes) {
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
        if (card.kind === 'lost') {
          card.title = 'Search area published';
          card.body = `${card.body} Boats keep clear of the search area. Close it when the owner has it back.`;
          card.actions = [{ id: 'found', label: 'Found', primary: true }, { id: 'ok', label: 'OK' }];
          return;
        }
        done();
        return;
      }
      case 'discard':
        if (card.draftId) this.discardDraft(card.draftId);
        done();
        return;
      case 'publishUpdate': {
        const n = card.noticeId ? this.notices.get(card.noticeId) : undefined;
        const z = n ? this.zones.get(n.zoneId) : undefined;
        if (z && n && z.pendingArea) this.applyAreaUpdate(z, n, z.pendingArea, 'officer', `${card.title}. Approved by ${this.officer}.`);
        this.removeCards((k) => k.id === cardId);
        return;
      }
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
      case 'confirmSighting':
        this.confirmSighting(card.key.slice('sighting:'.length));
        return;
      case 'found':
        if (card.contactId) this.foundRobot(card.contactId);
        this.removeCards((k) => k.id === cardId);
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
    this.handToPhone(pick);
    return { vesselId: pick.id, name: pick.name };
  }

  private handToPhone(craft: CraftSim): void {
    const t = this.simMin;
    for (const n of this.notices.values()) {
      if (n.status !== 'active') continue;
      const rec = this.deliveries.get(`${n.id}:${craft.id}`);
      const entry = n.perVessel.get(craft.id);
      if (!rec || !entry || !rec.simulated) continue;
      if (craft.rerouteNoticeId === n.id) restoreRoute(this.h, craft);
      if (entry.action === 'wait') craft.held = false;
      rec.simulated = false;
      rec.channel = 'app';
      rec.states = { sent: t };
      rec.plannedDelivered = rec.plannedSeen = rec.plannedAck = null;
      rec.resends = 0;
      rec.notResponding = false;
      rec.urgentSinceMin = entry.priority === 'P1' || entry.priority === 'P2' ? t : null;
      this.removeCards((k) => k.key === `vhf:${n.id}:${craft.id}`);
      this.queueAlertPush(n, craft.id, entry);
    }
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
      contactId: z.contactId, noticeId: z.noticeId, area: this.areaView(z),
    };
  }

  private areaView(z: ZoneRec): P.AreaView | null {
    if (!z.area) return null;
    return { version: z.area.version, likely: z.area.shapes.likely, careful: z.area.shapes.careful, ticks: z.area.ticks, changedAtLabel: z.changedAtMin ? clockLabel(z.changedAtMin) : null };
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
      forecast: this.forecastSummary(c),
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

  private affectedVessels(): Map<string, NonNullable<P.VesselView['affected']>> {
    const order: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
    const out = new Map<string, NonNullable<P.VesselView['affected']>>();
    const offer = (id: string, a: NonNullable<P.VesselView['affected']>) => {
      const prev = out.get(id);
      if (!prev || order[a.priority] < order[prev.priority]) out.set(id, a);
    };
    for (const n of this.notices.values()) {
      if (n.status !== 'active') continue;
      for (const [vid, e] of n.perVessel) {
        if (e.priority === 'P4' && (e.action === 'none' || e.action === 'headsUp')) continue;
        if (e.priority === 'P4') continue;
        offer(vid, { priority: e.priority, text: e.instructionText, crossingLabel: e.crossing ? clockLabel(e.crossing.atMin) : null, untilLabel: e.untilMin ? clockLabel(e.untilMin) : null });
      }
    }
    for (const d of this.drafts.values()) {
      for (const b of d.plan.boats) {
        if (b.priority === 'P4') continue;
        offer(b.vesselId, { priority: b.priority, text: b.instruction, crossingLabel: b.crossingLabel, untilLabel: b.untilLabel });
      }
    }
    return out;
  }

  commandSnapshot(extra: { aisOnTime?: P.OnTimeRow[]; joinUrls?: string[] } = {}): P.CommandSnapshot {
    const vessels: P.VesselView[] = [];
    const affected = this.affectedVessels();
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
        affected: affected.get(c.id) ?? null,
      });
    }
    for (const v of this.ais) {
      vessels.push({
        id: `ais-${v.mmsi}`, name: v.name || `MMSI ${v.mmsi}`, type: v.typeLabel, lonlat: this.aisLonLat(v), headingDeg: v.headingDeg ?? v.cogDeg, speedKn: v.sogKn,
        source: v.source === 'live' ? 'ais-live' : 'ais-replay', lengthM: v.lengthM, route: null, newRoute: null, phone: null,
        inZone: v.cell >= 0 && zoneMasks.some((m) => m[v.cell] === 1),
        affected: affected.get(`ais-${v.mmsi}`) ?? null,
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
      onTime: [...this.onTimeRows(), ...this.withZoneDelays(extra.aisOnTime ?? [])],
      audit: this.audit.slice(-80).reverse(),
      marineLog: this.marineLog.slice(-30).reverse(),
      orders: this.signedOrders,
      sources: { ...this.sources, ais: { ...this.sources.ais, vessels: this.ais.length } },
      berths: { cruiseDocked: this.cruiseDocked, cruiseShip: this.cruiseShip },
      captains: [...this.captains.values()].map((c) => ({ vesselId: c.vesselId, vesselName: this.craft.find((k) => k.id === c.vesselId)?.name ?? c.vesselId, connected: c.connected, lastSeenWall: c.lastSeenWall })),
      officer: this.officer,
      joinUrls: extra.joinUrls ?? [],
      sightings: this.sightingViews(),
      today: this.todayRows(),
      report: this.dailyReport(),
      headline: this.headline(),
      steps: this.steps(),
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
    return { simMin: this.simMin, label: clockLabel(this.simMin), timeScale: this.timeScale, paused: this.paused, night: this.night, wallMs: this.wallMs };
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

  private captainDetail(n: NoticeRec, entry: VesselPlanEntry, inside: boolean): string {
    if (n.kind === 'security' && entry.fixAreaVersion !== undefined) {
      const c = entry.crossing;
      if (!c) return 'Not on your route. Keep a lookout.';
      const window = `${clockLabel(c.droneEarlyMin)} to ${clockLabel(c.droneLateMin)}`;
      if (entry.priority === 'P3' || entry.priority === 'P4') return `Unknown vessel expected near your route ${window}. No action needed yet.`;
      return `Unknown vessel crosses your route ${window}.`;
    }
    return inside ? 'You are inside the zone.' : entry.minutesToZone !== null ? `Your route reaches it in ${minutesLabel(entry.minutesToZone)}.` : 'Not on your route.';
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
          detail: this.captainDetail(n, entry, inside),
          place: this.placeNear(z.centerCell), relative, acknowledgedAtLabel: ackAt !== undefined ? clockLabel(ackAt) : null,
          addedMin: entry.addedMin, rerouted: !!entry.newRoute || c.rerouteNoticeId === n.id,
          distanceM: inside ? 0 : isFinite(nearest) ? nearest : null, minutesToZone: entry.minutesToZone,
          acknowledged: rec?.states.acknowledged !== undefined, translations: n.wording.translations,
          untilLabel: entry.untilMin !== undefined && entry.untilMin !== null ? clockLabel(entry.untilMin) : null,
          crossingLabel: entry.crossing ? `${clockLabel(entry.crossing.droneEarlyMin)} to ${clockLabel(entry.crossing.droneLateMin)}` : null,
          area: this.areaView(z),
        });
      }
    }
    const order: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
    notices.sort((a, b) => order[a.priority] - order[b.priority]);
    const today: P.CaptainTodayRow[] = [];
    if (c) {
      const route = remainingRoute(c);
      for (const n of this.notices.values()) {
        if (n.status !== 'active' || n.kind === 'security') continue;
        const z = this.zones.get(n.zoneId);
        if (!z) continue;
        const onRoute = routeEntersMask(route, z.geometry.mask);
        today.push({
          id: n.id, label: n.label ?? `${n.publicReason} near ${this.placeNear(z.centerCell).replace(/^the /, '')}`, reason: n.publicReason,
          timesLabel: `${clockLabel(n.startsAtMin ?? n.publishedAtMin)} to ${clockLabel(n.expiresAtMin)}`, instructionText: n.perVessel.get(c.id)?.instructionText ?? n.instructionText,
          onRoute, simulated: !!n.simulated,
        });
      }
      today.sort((a, b) => Number(b.onRoute) - Number(a.onRoute));
    }
    const rerouted = !!c?.rerouteNoticeId;
    const proposal = !rerouted && c ? this.proposedRoute(c) : null;
    return {
      vessel: c ? {
        id: c.id, name: c.name, type: c.type, lonlat: craftLonLat(this.h, c), headingDeg: c.headingDeg, speedKn: c.held ? 0 : mpsToKnots(c.speedMps),
        route: rerouted ? null : this.routeLonLat(remainingRoute(c), 3),
        newRoute: rerouted ? this.routeLonLat(remainingRoute(c), 3) : proposal ? this.routeLonLat(proposal, 3) : null,
      } : null,
      notices,
      today,
      traffic: [
        ...this.craft.filter((k) => k.id !== vesselId).map((k) => ({ lonlat: craftLonLat(this.h, k), headingDeg: k.headingDeg, type: k.type })),
        ...this.ais.map((v) => ({ lonlat: this.aisLonLat(v), headingDeg: v.headingDeg ?? v.cogDeg, type: v.typeLabel })),
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
      case 'reportSighting': { const e = p as P.CommandEvents['reportSighting']; this.reportSighting(e, 'desk', 'Harbor desk'); return; }
      case 'confirmSighting': this.confirmSighting((p as P.CommandEvents['confirmSighting']).id); return;
      case 'extendZone': { const e = p as P.CommandEvents['extendZone']; this.extendZone(e.noticeId, e.minutes); return; }
      case 'endZone': this.clearNotice((p as P.CommandEvents['endZone']).noticeId, 'officer'); return;
      case 'fileDivePlan': this.fileDivePlan(p); return;
      case 'foundRobot': this.foundRobot((p as P.CommandEvents['foundRobot']).contactId); return;
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
