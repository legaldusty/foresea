import type { LonLat } from '../engine/geo';
import type { CustomOrder } from './orders';

export type Theme = 'night' | 'day';
export type Level = 'Low' | 'Medium' | 'Serious' | 'High' | 'Critical';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type DeliveryState = 'sent' | 'delivered' | 'seen' | 'acknowledged' | 'complying';
export type Channel = 'app' | 'push' | 'sms' | 'vhf' | 'ais';
export type ContactKind = 'powered' | 'debris' | 'animal' | 'person' | 'friendly' | 'unknown';
export type NoticeKind = 'security' | 'whale' | 'divers' | 'dredge' | 'person' | 'closure' | 'search' | 'slow';
export type PublicReason = 'Security zone' | 'Whale nearby' | 'Divers in water' | 'Dredge working' | 'Person in the water' | 'Area closed' | 'Search area' | 'Slow zone';
export type Species = 'whale' | 'dolphin' | 'sea lion' | 'debris' | 'hazard';
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

export interface ForecastTickView { lonlat: LonLat; label: string; minutes: number }

export interface ForecastSummary {
  version: number;
  madeAtLabel: string;
  topId: string | null;
  topName: string | null;
  topP: number;
  arrival: { name: string; share: number; earlyLabel: string; lateLabel: string } | null;
  words: string;
  drifting: boolean;
}

export interface ForecastView {
  contactId: string;
  version: number;
  likely: LonLat[][][];
  careful: LonLat[][][];
  ticks: ForecastTickView[];
}

export interface AreaView {
  version: number;
  likely: LonLat[][][];
  careful: LonLat[][][];
  ticks: ForecastTickView[];
  changedAtLabel: string | null;
}

export type OperatingMode = 'live' | 'sim';

export interface SensorView {
  lonlat: LonLat;
  depthM: number;
  headingDeg: number;
  speedMps: number;
  speedKn: number;
  sizeM: number;
  heatDeltaC: number;
  heatLabel: string;
  acousticDb: number;
  observedMin: number;
  lastFixSec: number;
  trackKm: number;
  confidence: number;
  simulated: boolean;
  source: string;
}

export interface ConsequenceView { targetId: string; name: string; C: number; people: number; hazard: number; economy: number; environment: number; odds: number; etaMin: number | null }

export interface RiskMathView {
  H: number;
  P: number;
  K: number;
  C: number;
  likelihood: number;
  severity: number;
  L: number;
  S: number;
  R: number;
  likelihoodBands: number[];
  severityBands: number[];
  levelMaxScores: number[];
  sizeFactor: number;
  speedFactor: number;
  weights: Record<string, number>;
}

export interface TimelineEntry { atMin: number; label: string; detail: string; actor: string }

export interface ContactView {
  id: string;
  label: string;
  mode: 'driven' | 'bot' | 'scenario' | 'drift' | 'external';
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
  forecast: ForecastSummary | null;
  track: LonLat[];
  zoneId: string | null;
  why: string;
  history: { t: number; p: number[] }[];
  historyIds: string[];
  sensor: SensorView;
  classificationWhy: string[];
  consequences: ConsequenceView[];
  riskMath: RiskMathView | null;
  timeline: TimelineEntry[];
  analystNote: { text: string; source: 'granite' | 'template' } | null;
}

export interface VesselIntel {
  score: number;
  level: 'normal' | 'watch' | 'anomalous';
  reasons: string[];
  features: { label: string; value: string; z: number | null }[];
}

export interface VesselDetail {
  mmsi: number | null;
  destination: string | null;
  etaReported: string | null;
  sogKn: number;
  cogDeg: number;
  headingDeg: number | null;
  lastSeenSec: number | null;
  status: string;
  activity: string | null;
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
  affected: { priority: Priority; text: string; crossingLabel: string | null; untilLabel: string | null } | null;
  intel: VesselIntel | null;
  detail: VesselDetail;
  trail?: LonLat[];
}

export interface ModelCard {
  id: string;
  name: string;
  kind: string;
  role: string;
  decides: boolean;
  trainedOn: string;
  metrics: { label: string; value: string }[];
  lastRunMs: number | null;
  runsPerMinute: number | null;
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
  area: AreaView | null;
  center: LonLat;
}

export interface FixOptionView { kind: string; label: string; addedMin: number | null; why: string }

export interface BoatImpactView {
  vesselId: string;
  name: string;
  priority: Priority;
  instruction: string;
  addedMin: number;
  action: string;
  minutesToZone: number | null;
  simulated: boolean;
  crossingLabel: string | null;
  untilLabel: string | null;
  noGentle: boolean;
  options: FixOptionView[];
}

export interface PlanView {
  kind: 'watch' | 'speedAdvisory' | 'reroute' | 'hold' | 'closeChannel' | 'giveWay';
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
  label?: string | null;
  filedBy?: string | null;
  startsAtMin?: number | null;
  largeShipsOnly?: boolean;
  simulated?: boolean;
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
  kind: 'publish' | 'update' | 'hold' | 'handoff' | 'notResponding' | 'lost' | 'animal' | 'person' | 'info';
  title: string;
  body: string;
  facts: string[];
  actions: CardAction[];
  createdAtMin: number;
  realerts: number;
  backupCalled: boolean;
  autoAtWall?: number | null;
  autoOrder?: string | null;
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
  zoneNote?: string | null;
}

export interface Sighting {
  id: string;
  species: Species;
  lonlat: LonLat;
  atMin: number;
  dayOffset: number;
  whenLabel: string;
  source: 'desk' | 'phone' | 'ship crew' | 'sensor' | 'researcher';
  reporter: string;
  status: 'reported' | 'confirmed';
  simulated: boolean;
  note: string;
}

export interface TodayRow {
  id: string;
  noticeId: string | null;
  label: string;
  reason: PublicReason;
  kind: NoticeKind;
  status: 'active' | 'scheduled';
  timesLabel: string;
  filedBy: string | null;
  boatsAffected: number;
  ackRate: number | null;
  simulated: boolean;
  lonlat: LonLat;
}

export interface DailyReport {
  dayLabel: string;
  zonesIssued: number;
  boatsNotified: number;
  acknowledged: number;
  ackRate: number | null;
  delayMinutes: number;
  whaleShips: number;
  whaleHonored: number;
  sightings: number;
  simulatedShare: number;
  lines: string[];
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
  where?: AuditWhere;
}

export interface IncidentReport {
  contactId: string;
  label: string;
  simulated: boolean;
  source: string;
  status: 'open' | 'all clear' | 'closed';
  station: string;
  detected: { atLabel: string; place: string; readings: string };
  classification: string;
  hostility: number | null;
  call: { atLabel: string; target: string; odds: number; afterDetectionMin: number } | null;
  arrival: { atLabel: string; place: string; reached: boolean } | null;
  leadMin: number | null;
  peak: { score: number; level: string; atLabel: string } | null;
  notice: { draftedLabel: string | null; publishedLabel: string | null; publishedBy: string | null; afterDetectionMin: number | null; warningBeforeArrivalMin: number | null; instruction: string | null } | null;
  boats: { told: number; p1: number; p2: number; acknowledged: number; medianAckSec: number | null; notResponding: string[]; vhfCalled: string[]; shipsByAis: number };
  delayBoatMin: number;
  gatesClosed: number;
  allClearLabel: string | null;
  durationMin: number;
  machineDid: string[];
  peopleDid: string[];
  timeline: { atLabel: string; actor: string; action: string; detail: string }[];
}

export interface BoardNotice {
  id: string;
  publicReason: string;
  label: string | null;
  instructionText: string;
  place: string;
  fromLabel: string;
  untilLabel: string;
  kind: 'keepOut' | 'slow';
  largeShipsOnly: boolean;
  rings: LonLat[][][];
  center: LonLat;
}

export interface PublicBoard {
  station: string;
  mode: OperatingMode;
  clockLabel: string;
  updatedWall: string;
  notices: BoardNotice[];
  allClear: { publicReason: string; atLabel: string }[];
  ships: { id: string; lonlat: LonLat; headingDeg: number; type: string }[];
  link: string;
}

export interface IncidentSummary { contactId: string; label: string; status: IncidentReport['status']; detectedLabel: string; simulated: boolean }

export interface AuditWhere { lonlat: LonLat; radiusM: number | null; zoneId: string | null; contactId: string | null; vesselId: string | null; place: string | null }

export interface MarineLogEntry { id: string; atMin: number; lonlat: LonLat; kind: string; detail: string }

export interface SignedOrders { signedBy: string | null; signedAtWall: string | null; orders: Record<string, number>; custom?: CustomOrder[] }

export interface ClockView { simMin: number; label: string; timeScale: number; paused: boolean; night: boolean; wallMs: number }

export interface SourceStatus {
  ais: { mode: 'live' | 'replay' | 'offline'; detail: string; vessels: number };
  noaa: { source: string; detail: string; currentKn: number | null; towardDeg: number | null; observedAt: string | null };
  language: { source: 'granite' | 'template'; model: string | null; detail: string };
  push: { ready: boolean; detail: string };
}

export interface CaptainLink { vesselId: string; vesselName: string; connected: boolean; lastSeenWall: string | null }

export type StepKey = 'detect' | 'predict' | 'assess' | 'warn' | 'confirm';

export interface StepView { key: StepKey; label: string; fact: string | null; reached: boolean; current: boolean }

export interface Headline { text: string; tone: 'calm' | 'watch' | 'act' | 'alert'; contactId: string | null }

export interface Sourced<T> { value: T; source: string; observedAt: string; ageMin: number }

export type ConditionsField =
  | 'waterLevel' | 'tideTrend' | 'nextHigh' | 'nextLow' | 'wind' | 'gust' | 'windFrom'
  | 'waveHeight' | 'wavePeriod' | 'waveFrom' | 'waterTemp' | 'airTemp' | 'pressure' | 'advisories' | 'forecast';

export type TideTrend = 'rising' | 'falling' | 'steady';

export interface TideTurnView { kind: 'high' | 'low'; at: string; label: string; meters: number }

export interface SeriesPoint { at: string; value: number }

export interface WindPoint { at: string; speedMps: number; gustMps: number | null }

export interface AdvisoryView {
  id: string;
  event: string;
  headline: string;
  summary: string;
  severity: string;
  onset: string | null;
  ends: string | null;
  endsLabel: string | null;
  areaDesc: string;
  instruction: string | null;
  sender: string;
  sentAt: string;
  relayedBy: string | null;
  relayedAtLabel: string | null;
}

export interface MarineForecastView { zone: string; zoneName: string; issuedAt: string | null; periods: { name: string; text: string }[] }

export interface ConditionsSourceView { id: string; label: string; ok: boolean; detail: string; observedAt: string | null; ageMin: number | null }

export interface ConditionsView {
  datum: string;
  waterLevelM: Sourced<number> | null;
  tideTrend: Sourced<TideTrend> | null;
  nextHigh: Sourced<TideTurnView> | null;
  nextLow: Sourced<TideTurnView> | null;
  windMps: Sourced<number> | null;
  gustMps: Sourced<number> | null;
  windFromDeg: Sourced<number> | null;
  waveHeightM: Sourced<number> | null;
  wavePeriodS: Sourced<number> | null;
  waveFromDeg: Sourced<number> | null;
  waterTempC: Sourced<number> | null;
  airTempC: Sourced<number> | null;
  pressureHpa: Sourced<number> | null;
  sunrise: Sourced<{ at: string; label: string }> | null;
  sunset: Sourced<{ at: string; label: string }> | null;
  advisories: Sourced<AdvisoryView[]> | null;
  forecast: Sourced<MarineForecastView> | null;
  tideCurve: Sourced<SeriesPoint[]> | null;
  tideMeasured: Sourced<SeriesPoint[]> | null;
  tideTurns: Sourced<TideTurnView[]> | null;
  windHistory: Sourced<WindPoint[]> | null;
  waveHistory: Sourced<SeriesPoint[]> | null;
  missing: Partial<Record<ConditionsField, string>>;
  sources: ConditionsSourceView[];
}

export interface CaptainReading { value: number; source: string; ageMin: number }

export interface CaptainConditions {
  wind: { speedMps: number; gustMps: number | null; fromDeg: number | null; source: string; ageMin: number; history: WindPoint[] } | null;
  waves: { heightM: number; periodS: number | null; fromDeg: number | null; source: string; ageMin: number; history: SeriesPoint[] } | null;
  nextTide: { kind: 'high' | 'low'; label: string; meters: number; source: string } | null;
  tide: {
    levelM: CaptainReading | null;
    trend: TideTrend | null;
    datum: string;
    source: string;
    turns: TideTurnView[];
    curve: SeriesPoint[];
    measured: SeriesPoint[];
  } | null;
  waterTempC: CaptainReading | null;
  airTempC: CaptainReading | null;
  pressureHpa: CaptainReading | null;
  sunrise: string | null;
  sunset: string | null;
  forecast: { zoneName: string; issuedLabel: string | null; ageMin: number; periods: { name: string; text: string }[] } | null;
  timeZone: string;
  nowWall: string;
}

export interface CaptainBulletin { id: string; title: string; detail: string; until: string | null; untilLabel: string | null; source: 'NWS'; relayedBy: string; relayedAtLabel: string }

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
  sightings: Sighting[];
  today: TodayRow[];
  report: DailyReport;
  headline: Headline;
  steps: StepView[] | null;
  mode: OperatingMode;
  incidents: IncidentSummary[];
  models: ModelCard[];
  conditions: ConditionsView;
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
  untilLabel: string | null;
  crossingLabel: string | null;
  area: AreaView | null;
}

export interface CaptainTodayRow { id: string; label: string; reason: PublicReason; timesLabel: string; instructionText: string; onRoute: boolean; simulated: boolean }

export interface CaptainSos {
  state: 'sent' | 'published' | 'recovered' | 'falseAlarm';
  atLabel: string;
  place: string;
  position: string;
  publishedAtLabel: string | null;
  boatsTold: number;
  briefSent: boolean;
  drift: string;
}

export interface CaptainSnapshot {
  vessel: { id: string; name: string; type: string; lonlat: LonLat; headingDeg: number; speedKn: number; route: LonLat[] | null; newRoute: LonLat[] | null } | null;
  notices: CaptainNotice[];
  today: CaptainTodayRow[];
  traffic: { id: string; lonlat: LonLat; headingDeg: number; type: string }[];
  allClear: { id: string; publicReason: string; atWall: string; atLabel: string; approvedBy: string }[];
  lastAllClearLabel: string | null;
  clock: ClockView;
  serverWall: string;
  conditions: CaptainConditions;
  bulletins: CaptainBulletin[];
  sos: CaptainSos | null;
}

export interface CommandEvents {
  drive: { contactId: string; lonlat: LonLat };
  spawn: { preset: 'driven' | 'bot' | 'pair' | 'scenario' | 'glider' | 'whale' | 'diver' | 'friendly'; scenarioKey?: string; at?: LonLat };
  removeContact: { contactId: string };
  contactParams: { contactId: string; sizeM?: number; speedMps?: number };
  sensorLoss: { contactId: string; silent: boolean };
  editDraft: { draftId: string; edits: Partial<Pick<NoticeDraft, 'instruction' | 'radiusM' | 'recipients' | 'named' | 'publicReason' | 'validForMin' | 'slowKnots'>> };
  publish: { draftId: string };
  discardDraft: { draftId: string };
  dropZone: { kind: 'whale' | 'divers' | 'dredge' | 'closure' | 'slow'; lonlat: LonLat; radiusM?: number };
  reportSighting: { species: Species; lonlat: LonLat; note?: string };
  confirmSighting: { id: string };
  extendZone: { noticeId: string; minutes: number };
  endZone: { noticeId: string };
  fileDivePlan: { by: string; lonlat: LonLat; startHour: number; endHour: number; radiusM?: number };
  foundRobot: { contactId: string };
  allClear: { noticeId?: string };
  cardAction: { cardId: string; actionId: string };
  clock: { timeScale?: number; paused?: boolean; setHour?: number };
  undo: { auditId: string };
  signOrders: { officer: string; orders: Record<string, number>; custom?: CustomOrder[] };
  officer: { name: string };
  reset: { mode: 'tuesday' | 'night' | 'empty' | 'live' };
  resizeZone: { zoneId: string; radiusM: number };
  markVhfCalled: { noticeId: string; vesselId: string };
  relayAdvisory: { advisoryId: string };
  sosDrill: { vesselId: string };
}

export interface CaptainEvents {
  join: { vesselId?: string; token?: string };
  delivered: { noticeId: string; vesselId?: string };
  seen: { noticeId: string; vesselId?: string };
  gotIt: { noticeId: string; vesselId?: string };
  pushSubscription: { subscription: unknown; vesselId?: string };
  reportSighting: { species: Species; lonlat: LonLat; note?: string; vesselId?: string };
  sos: { action: 'send' | 'cancel' | 'recovered'; vesselId?: string };
}

export interface SensorDetection {
  sensorId: string;
  trackId: string;
  time: string;
  lat: number;
  lon: number;
  depthM?: number;
  speedMps?: number;
  headingDeg?: number;
  sizeM?: number;
  heat?: 'hot' | 'warm' | 'cold';
  acousticDb?: number;
  pingReply?: 'none' | 'correct' | 'wrong';
  confidence?: number;
}

export interface SensorIngestResult { sensorId: string; trackId: string; contactId: string | null; status: 'new' | 'updated' | 'stale' | 'full' | 'land' }

export interface PilotEvents {
  launch: Record<string, never>;
  steer: { lonlat: LonLat };
  surface: Record<string, never>;
}

export interface PilotSnapshot {
  mode: OperatingMode;
  clock: ClockView;
  drone: { id: string; label: string; lonlat: LonLat; headingDeg: number; speedKn: number; steerTo: LonLat | null; track: LonLat[] } | null;
  targets: { id: string; name: string; lonlat: LonLat }[];
  launch: { name: string; lonlat: LonLat };
  serverWall: string;
}
