import { defaultSettings, type Settings } from './settings';

export type Heat = 'hot' | 'warm' | 'ambient';

export type ContactKind = 'powered' | 'debris' | 'animal' | 'person' | 'unknown';

export interface SensorReading {
  speedMps: number;
  heat: Heat;
  sizeM: number;
  erratic?: boolean;
  currentSpeedMps?: number;
}

export interface Classification {
  kind: ContactKind;
  label: string;
  threatScored: boolean;
  powered: boolean;
  handling: string;
}

const KIND_DETAILS: Record<ContactKind, Omit<Classification, 'kind' | 'powered'>> = {
  powered: { label: 'Powered unknown', threatScored: true, handling: 'Full risk model' },
  debris: { label: 'Debris / dead robot', threatScored: true, handling: 'Log and keep-clear zone' },
  animal: { label: 'Marine animal', threatScored: false, handling: 'Animal slow zone and marine-life log' },
  person: { label: 'Person (diver or swimmer)', threatScored: false, handling: 'Route boats away and hand off to port police' },
  unknown: { label: 'Unidentified contact', threatScored: true, handling: 'Full risk model' },
};

function within(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function describe(kind: ContactKind, reading: SensorReading): Classification {
  return { kind, powered: reading.heat === 'hot', ...KIND_DETAILS[kind] };
}

function fitsPowered(r: SensorReading, c: Settings['classify']): boolean {
  const p = c.powered;
  return r.heat === p.heat && within(r.speedMps, p.minMps, p.maxMps) && within(r.sizeM, p.minSizeM, p.maxSizeM);
}

function fitsDebris(r: SensorReading, c: Settings['classify']): boolean {
  const d = c.debris;
  return r.heat === d.heat && Math.abs(r.speedMps - (r.currentSpeedMps ?? 0)) <= d.currentToleranceMps;
}

function fitsAnimal(r: SensorReading, c: Settings['classify']): boolean {
  const a = c.animal;
  return r.heat === a.heat && within(r.speedMps, a.minMps, a.maxMps) && within(r.sizeM, a.minSizeM, a.maxSizeM);
}

function fitsPerson(r: SensorReading, c: Settings['classify']): boolean {
  const p = c.person;
  return r.heat === p.heat && r.speedMps < p.maxMps && within(r.sizeM, p.minSizeM, p.maxSizeM);
}

export function classify(reading: SensorReading, settings: Settings = defaultSettings): Classification {
  const c = settings.classify;
  if (fitsPowered(reading, c)) return describe('powered', reading);
  if (fitsDebris(reading, c)) return describe('debris', reading);
  if (reading.erratic && fitsAnimal(reading, c)) return describe('animal', reading);
  if (fitsPerson(reading, c)) return describe('person', reading);
  if (fitsAnimal(reading, c)) return describe('animal', reading);
  return describe('unknown', reading);
}

export function sizeFactor(sizeM: number, settings: Settings = defaultSettings): number {
  const [small, large, veryLarge] = settings.classify.sizeBandsM;
  const f = settings.risk.sizeFactor;
  if (sizeM < small) return f.micro;
  if (sizeM < large) return f.small;
  if (sizeM < veryLarge) return f.large;
  return f.veryLarge;
}

export function speedFactor(speedMps: number, powered: boolean, settings: Settings = defaultSettings): number {
  const [slow, medium, fast] = settings.classify.speedBandsMps;
  const f = settings.risk.speedFactor;
  if (!powered) return f.drift;
  if (speedMps < slow) return f.drift;
  if (speedMps < medium) return f.slow;
  if (speedMps <= fast) return f.medium;
  return f.fast;
}

export function capability(sizeM: number, speedMps: number, powered: boolean, settings: Settings = defaultSettings): number {
  return sizeFactor(sizeM, settings) * speedFactor(speedMps, powered, settings);
}

export type ReplyStatus = 'none' | 'friendly' | 'registeredSilent' | 'spoof';

export interface HostilityInput {
  reply: ReplyStatus;
  minutesSinceDetected: number;
  steps: number;
  lostOdds: number;
  evasiveRatio: number;
  minutesNearTarget: number;
  cellsToSecurityTarget: number;
  night: boolean;
  cellMeters: number;
  planFiled?: boolean;
  debris?: boolean;
  coordinatedCount?: number;
}

export type EvidenceKey =
  | 'friendly' | 'start' | 'registryNoReply' | 'noReply' | 'spoofedId' | 'goalDirected' | 'lostLooking'
  | 'evasive' | 'loiter' | 'securityZone' | 'coordinated' | 'nightNoPlan' | 'debris';

export interface EvidenceItem {
  key: EvidenceKey;
  label: string;
  delta?: number;
  set?: number;
}

export interface Hostility {
  H: number;
  items: EvidenceItem[];
}

export const EVIDENCE_LABELS: Record<EvidenceKey, string> = {
  friendly: 'Positive ID: registry match and correct reply',
  start: 'Unknown contact: assume bad until identified',
  registryNoReply: 'Registry match but no reply to the ID ping',
  noReply: 'No reply to ID pings',
  spoofedId: 'Replied with an ID that is not registered or does not match',
  goalDirected: 'Goal-directed: moving with purpose',
  lostLooking: 'Lost-looking: drifting, not aiming',
  evasive: 'Evasive: travelled much farther than it needed',
  loiter: 'Loitering near a target',
  securityZone: 'Inside a security zone around fuel or passengers',
  coordinated: 'Another unknown heading for a target at the same time',
  nightNoPlan: 'Night, and no plan filed',
  debris: 'Classified as debris or a dead robot',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function evidenceCells(cellMeters: number, settings: Settings = defaultSettings) {
  const r = settings.evidenceRules;
  return { loiterCells: r.loiterMeters / cellMeters, securityCells: r.securityZoneMeters / cellMeters };
}

class EvidenceLedger {
  H = 0;
  readonly items: EvidenceItem[] = [];

  set(key: EvidenceKey, value: number): void {
    this.H = value;
    this.items.push({ key, label: EVIDENCE_LABELS[key], set: value });
  }

  add(key: EvidenceKey, delta: number): void {
    this.H += delta;
    this.items.push({ key, label: EVIDENCE_LABELS[key], delta });
  }
}

export function hostility(input: HostilityInput, settings: Settings = defaultSettings): Hostility {
  const e = settings.risk.evidence;
  const r = settings.evidenceRules;
  const ledger = new EvidenceLedger();
  if (input.reply === 'friendly') {
    ledger.set('friendly', e.friendlyConfirmed);
    return { H: ledger.H, items: ledger.items };
  }
  const { securityCells } = evidenceCells(input.cellMeters, settings);
  if (input.reply === 'registeredSilent') ledger.set('registryNoReply', e.registryNoReply);
  else ledger.set('start', settings.risk.startHostility);
  if (input.reply === 'none' && input.minutesSinceDetected >= r.noReplyAfterMinutes) ledger.add('noReply', e.noReply);
  if (input.reply === 'spoof') ledger.add('spoofedId', e.spoofedId);
  if (input.steps >= r.goalDirectedMinSteps && input.lostOdds < r.goalDirectedLostBelow) ledger.add('goalDirected', e.goalDirected);
  if (input.lostOdds > r.lostLookingAbove) ledger.add('lostLooking', e.lostLooking);
  if (input.evasiveRatio > r.evasiveRatio && input.steps > r.evasiveMinSteps) ledger.add('evasive', e.evasive);
  if (input.minutesNearTarget > r.loiterMinutes) ledger.add('loiter', e.loiter);
  if (input.cellsToSecurityTarget <= securityCells) ledger.add('securityZone', e.securityZone);
  if (input.night && !input.planFiled) ledger.add('nightNoPlan', e.nightNoPlan);
  const coordinated = input.coordinatedCount ?? 0;
  if (coordinated > 0) ledger.add('coordinated', Math.min(coordinated * e.coordinatedEach, r.coordinatedMax));
  if (input.debris) ledger.set('debris', r.debrisHostility);
  return { H: clamp(ledger.H, r.hostilityMin, r.hostilityMax), items: ledger.items };
}

export function isSecurityKind(kind: string, settings: Settings = defaultSettings): boolean {
  return (settings.evidenceRules.securityKinds as string[]).includes(kind);
}

export function cellsToNearest(fields: Float32Array[], cell: number, include: (g: number) => boolean = () => true): number {
  let best = Infinity;
  for (let g = 0; g < fields.length; g++) if (include(g) && fields[g][cell] < best) best = fields[g][cell];
  return best;
}

export interface LoiterClock {
  update(t: number, nearTarget: boolean): number;
  reset(): void;
}

export function createLoiterClock(): LoiterClock {
  let since: number | null = null;
  return {
    update(t, nearTarget) {
      if (!nearTarget) { since = null; return 0; }
      since ??= t;
      return t - since;
    },
    reset() { since = null; },
  };
}
