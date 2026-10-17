import type { LonLat } from '../engine/geo';

export type Theme = 'night' | 'day';
export type Level = 'Low' | 'Medium' | 'Serious' | 'High' | 'Critical';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type DeliveryState = 'sent' | 'delivered' | 'seen' | 'acknowledged' | 'complying';
export type Channel = 'app' | 'push' | 'sms' | 'vhf' | 'ais';
export type ContactKind = 'powered' | 'debris' | 'animal' | 'person' | 'friendly' | 'unknown';
export type NoticeKind = 'security' | 'whale' | 'divers' | 'dredge' | 'person';
export type PublicReason = 'Security zone' | 'Whale nearby' | 'Divers in water' | 'Dredge working' | 'Person in the water';
export type Recipients = 'all' | 'small' | 'named';
export type DataSource = 'simulated' | 'ais-live' | 'ais-replay';

export const DELIVERY_STATES: DeliveryState[] = ['sent', 'delivered', 'seen', 'acknowledged', 'complying'];
export const LEVELS: Level[] = ['Low', 'Medium', 'Serious', 'High', 'Critical'];
export const RUNGS: Record<Level, string> = {
  Low: 'Log / Watch',
  Medium: 'Ask',
  Serious: 'Slow / give way',
  High: 'Hold one berth',
  Critical: 'Hand off',
};

export interface OddsRow { id: string; name: string; p: number; kind: 'target' | 'lost' | 'drift' }

export interface EvidenceRow { key: string; label: string; effect: string; why: string }

export interface PerTargetRisk { id: string; name: string; p: number; L: number; S: number; R: number }

export interface RiskView {
  score: number;
  level: Level;
  rawLevel: Level;
  rung: string;
  L: number;
  S: number;
  targetId: string;
  targetName: string;
  urgent: boolean;
  notes: string[];
  perTarget: PerTargetRisk[];
}

export interface ContactView {
  id: string;
  label: string;
  mode: 'driven' | 'bot' | 'scenario' | 'drift';
  scenarioKey: string | null;
  lonlat: LonLat;
  headingDeg: number;
  speedMps: number;
  sizeM: number;
  heat: 'hot' | 'warm' | 'ambient';
  silent: boolean;
  silentForMin: number;
  firstSeenMin: number;
  classification: { kind: ContactKind; label: string; detail: string };
  registry: { match: string | null; owner: string | null; divePlan: boolean; reply: 'none' | 'correct' | 'wrong' | 'pending'; pings: number };
  hostility: { H: number; items: EvidenceRow[] };
  capability: { K: number; sizeFactor: number; speedFactor: number };
  odds: OddsRow[];
  call: { targetId: string; name: string; p: number; sinceMin: number; etaMin: number | null } | null;
  risk: RiskView | null;
  eta: { targetId: string; name: string; minutes: number } | null;
  predicted: LonLat[][];
  track: LonLat[];
  zoneId: string | null;
  why: string;
}

export interface VesselView {
  id: string;
  name: string;
  type: string;
  lonlat: LonLat;
  headingDeg: number;
  speedKn: number;
  source: DataSource;
  lengthM: number | null;
  route: LonLat[] | null;
  newRoute: LonLat[] | null;
  phone: { joined: boolean; captain: string | null } | null;
  inZone: boolean;
}

export interface ZoneView {
  id: string;
  kind: 'keepOut' | 'slow';
  reason: PublicReason;
  status: 'draft' | 'published';
  rings: LonLat[][][];
  centerline: LonLat[];
  radiusM: number;
  movingTowardDeg: number | null;
  movingSpeedMps: number;
  contactId: string | null;
  noticeId: string | null;
}

export interface BoatImpactView {
  vesselId: string;
  name: string;
  priority: Priority;
  instruction: string;
  addedMin: number;
  action: string;
  minutesToZone: number | null;
  simulated: boolean;
}

export interface PlanView {
  kind: 'watch' | 'speedAdvisory' | 'reroute' | 'hold' | 'closeChannel';
  boats: BoatImpactView[];
  totalAddedMin: number;
  maxAddedMin: number;
  clears: boolean;
  withinOrders: boolean;
  reasons: string[];
  nextStepUp: string;
  comparison: { chosen: string; closeHarbor: string };
}

export interface Wording {
  source: 'granite' | 'template';
  model: string | null;
  notice: string;
  why: string;
  vhf: string;
  aisMarker: string;
  sms: string;
  translations: Record<string, string>;
  brief: string | null;
}

export interface NoticeDraft {
  id: string;
  kind: NoticeKind;
  contactId: string | null;
  zoneId: string;
  instruction: string;
  instructionText: string;
  radiusM: number;
  slowKnots: number;
  recipients: Recipients;
  named: string[];
  publicReason: PublicReason;
  validForMin: number;
  approvedBy: string;
  plan: PlanView;
  wording: Wording;
  createdAtMin: number;
  updatedAtMin: number;
  edited: boolean;
  routine: boolean;
}

export interface Notice extends NoticeDraft {
  publishedAtMin: number;
  publishedAtWall: string;
  expiresAtMin: number;
  status: 'active' | 'cleared' | 'expired';
}

export interface DeliveryRow {
  noticeId: string;
  vesselId: string;
  vesselName: string;
  simulated: boolean;
  channel: Channel;
  priority: Priority;
  states: Partial<Record<DeliveryState, number>>;
  resends: number;
  notResponding: boolean;
}

export interface CardAction { id: string; label: string; primary?: boolean }

export interface Card {
  id: string;
  kind: 'publish' | 'hold' | 'handoff' | 'notResponding' | 'lost' | 'animal' | 'person' | 'info';
  title: string;
  body: string;
  facts: string[];
  actions: CardAction[];
  createdAtMin: number;
  realerts: number;
  backupCalled: boolean;
  contactId: string | null;
  noticeId: string | null;
  draftId: string | null;
  script: string | null;
}

export interface OnTimeRow {
  id: string;
  name: string;
  type: string;
  source: DataSource;
  destination: string;
  plannedLabel: string;
  ourEtaLabel: string;
  deltaMin: number | null;
  status: 'on time' | 'at risk' | 'berthed' | 'anchored' | 'unknown' | 'late';
  why: string;
}

export interface AuditEntry {
  id: string;
  atMin: number;
  wall: string;
  actor: string;
  action: string;
  detail: string;
  undoable: boolean;
  undone: boolean;
}

export interface MarineLogEntry { id: string; atMin: number; lonlat: LonLat; kind: string; detail: string }

export interface SignedOrders { signedBy: string | null; signedAtWall: string | null; orders: Record<string, number> }

export interface ClockView { simMin: number; label: string; timeScale: number; paused: boolean; night: boolean }

export interface SourceStatus {
  ais: { mode: 'live' | 'replay' | 'offline'; detail: string; vessels: number };
  noaa: { source: string; detail: string; currentKn: number | null; towardDeg: number | null; observedAt: string | null };
  language: { source: 'granite' | 'template'; model: string | null; detail: string };
  push: { ready: boolean; detail: string };
}

export interface CaptainLink { vesselId: string; vesselName: string; connected: boolean; lastSeenWall: string | null }

export interface CommandSnapshot {
  clock: ClockView;
  contacts: ContactView[];
  vessels: VesselView[];
  zones: ZoneView[];
  drafts: NoticeDraft[];
  notices: Notice[];
  deliveries: DeliveryRow[];
  card: Card | null;
  cardsWaiting: number;
  onTime: OnTimeRow[];
  audit: AuditEntry[];
  marineLog: MarineLogEntry[];
  orders: SignedOrders;
  sources: SourceStatus;
  berths: { cruiseDocked: boolean; cruiseShip: string | null };
  captains: CaptainLink[];
  officer: string;
  joinUrls: string[];
}

export interface CaptainNotice {
  id: string;
  kind: NoticeKind;
  priority: Priority;
  instructionText: string;
  publicReason: PublicReason;
  zone: { rings: LonLat[][][]; centerline: LonLat[]; movingTowardDeg: number | null; movingSpeedMps: number; kind: 'keepOut' | 'slow' };
  validUntilWall: string;
  validUntilLabel: string;
  publishedAtWall: string;
  publishedAtLabel: string;
  approvedBy: string;
  detail: string;
  place: string;
  relative: string | null;
  addedMin: number;
  rerouted: boolean;
  acknowledgedAtLabel: string | null;
  distanceM: number | null;
  minutesToZone: number | null;
  acknowledged: boolean;
  translations: Record<string, string>;
}

export interface CaptainSnapshot {
  vessel: { id: string; name: string; type: string; lonlat: LonLat; headingDeg: number; speedKn: number; route: LonLat[] | null; newRoute: LonLat[] | null } | null;
  notices: CaptainNotice[];
  traffic: { lonlat: LonLat; headingDeg: number; type: string }[];
  allClear: { id: string; publicReason: string; atWall: string; atLabel: string; approvedBy: string }[];
  lastAllClearLabel: string | null;
  clock: ClockView;
  serverWall: string;
}

export interface CommandEvents {
  drive: { contactId: string; lonlat: LonLat };
  spawn: { preset: 'driven' | 'bot' | 'pair' | 'scenario' | 'glider' | 'whale' | 'diver'; scenarioKey?: string; at?: LonLat };
  removeContact: { contactId: string };
  contactParams: { contactId: string; sizeM?: number; speedMps?: number };
  sensorLoss: { contactId: string; silent: boolean };
  editDraft: { draftId: string; edits: Partial<Pick<NoticeDraft, 'instruction' | 'radiusM' | 'recipients' | 'named' | 'publicReason' | 'validForMin' | 'slowKnots'>> };
  publish: { draftId: string };
  discardDraft: { draftId: string };
  dropZone: { kind: 'whale' | 'divers' | 'dredge'; lonlat: LonLat; radiusM?: number };
  allClear: { noticeId?: string };
  cardAction: { cardId: string; actionId: string };
  clock: { timeScale?: number; paused?: boolean; setHour?: number };
  undo: { auditId: string };
  signOrders: { officer: string; orders: Record<string, number> };
  officer: { name: string };
  reset: { mode: 'tuesday' | 'night' | 'empty' };
  markVhfCalled: { noticeId: string; vesselId: string };
}

export interface CaptainEvents {
  join: { vesselId?: string; token?: string };
  delivered: { noticeId: string };
  seen: { noticeId: string };
  gotIt: { noticeId: string };
  pushSubscription: { subscription: unknown };
}
