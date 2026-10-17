import type { AisClass, AisVessel, DataSource, NavStatus, VesselTypeLabel } from '../../src/shared/ais-types';

const HEADING_UNAVAILABLE = 511;
const SOG_UNAVAILABLE = 102.3;
const COG_UNAVAILABLE = 360;
const LAT_UNAVAILABLE = 91;
const LON_UNAVAILABLE = 181;
const NAV_STATUS_UNDEFINED = 15;

const NAV_STATUS_LABELS: Record<number, string> = {
  0: 'under way using engine',
  1: 'at anchor',
  2: 'not under command',
  3: 'restricted manoeuvrability',
  4: 'constrained by draught',
  5: 'moored',
  6: 'aground',
  7: 'engaged in fishing',
  8: 'under way sailing',
  11: 'towing astern',
  12: 'pushing ahead or towing alongside',
  14: 'AIS-SART active',
  15: 'not defined',
};

export const NAV_MOORED = 5;
export const NAV_AT_ANCHOR = 1;

export function navStatusFor(code: number): NavStatus {
  return { code, label: NAV_STATUS_LABELS[code] ?? 'reserved' };
}

export function shipTypeLabel(code: number): VesselTypeLabel {
  if (code === 30) return 'fishing';
  if (code === 31 || code === 32 || code === 52) return 'tug';
  if (code === 36) return 'sailing';
  if (code === 37) return 'pleasure';
  if (code === 50) return 'pilot';
  if (code === 51) return 'sar';
  if (code === 55) return 'law';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  return 'other';
}

export interface AisEta {
  Month?: number;
  Day?: number;
  Hour?: number;
  Minute?: number;
}

export function parseEta(eta: AisEta | undefined | null, referenceMs: number): string | null {
  if (!eta) return null;
  const { Month: month, Day: day, Hour: hour, Minute: minute } = eta;
  if (!isWhole(month) || !isWhole(day) || !isWhole(hour) || !isWhole(minute)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const referenceYear = new Date(referenceMs).getUTCFullYear();
  let best: number | null = null;
  for (const year of [referenceYear - 1, referenceYear, referenceYear + 1]) {
    const candidate: number = Date.UTC(year, month - 1, day, hour, minute);
    if (new Date(candidate).getUTCDate() !== day) continue;
    if (best === null || Math.abs(candidate - referenceMs) < Math.abs(best - referenceMs)) best = candidate;
  }
  return best === null ? null : new Date(best).toISOString();
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function cleanAisText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface VesselUpdate {
  mmsi: number;
  at: number;
  kind: 'position' | 'static';
  aisClass?: AisClass;
  name?: string;
  position?: { lat: number; lon: number };
  metaPosition?: { lat: number; lon: number };
  sogKn?: number | null;
  cogDeg?: number | null;
  headingDeg?: number | null;
  navStatus?: number;
  shipType?: number;
  lengthM?: number | null;
  beamM?: number | null;
  destination?: string;
  etaReported?: string | null;
}

interface RawMeta {
  MMSI?: number;
  ShipName?: string;
  latitude?: number;
  longitude?: number;
}

interface RawPosition {
  UserID?: number;
  Valid?: boolean;
  Latitude?: number;
  Longitude?: number;
  Sog?: number;
  Cog?: number;
  TrueHeading?: number;
  NavigationalStatus?: number;
}

interface RawStatic {
  UserID?: number;
  Valid?: boolean;
  Name?: string;
  Type?: number;
  Destination?: string;
  Eta?: AisEta;
  Dimension?: { A?: number; B?: number; C?: number; D?: number };
}

interface RawEnvelope {
  MessageType?: string;
  MetaData?: RawMeta;
  Message?: Record<string, unknown>;
}

function validPosition(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) >= LAT_UNAVAILABLE || Math.abs(lon) >= LON_UNAVAILABLE) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

function speedKnots(sog: unknown): number | null {
  if (typeof sog !== 'number' || !Number.isFinite(sog) || sog < 0 || sog >= SOG_UNAVAILABLE) return null;
  return sog;
}

function courseDegrees(cog: unknown): number | null {
  if (typeof cog !== 'number' || !Number.isFinite(cog) || cog < 0 || cog >= COG_UNAVAILABLE) return null;
  return cog;
}

function headingDegrees(heading: unknown): number | null {
  if (typeof heading !== 'number' || !Number.isInteger(heading) || heading === HEADING_UNAVAILABLE) return null;
  if (heading < 0 || heading > 359) return null;
  return heading;
}

function dimension(a: unknown, b: unknown): number | null {
  const total = (typeof a === 'number' ? a : 0) + (typeof b === 'number' ? b : 0);
  return total > 0 ? total : null;
}

function mmsiOf(meta: RawMeta | undefined, body: { UserID?: number } | undefined): number | null {
  const mmsi = meta?.MMSI ?? body?.UserID;
  return typeof mmsi === 'number' && Number.isInteger(mmsi) && mmsi > 0 ? mmsi : null;
}

export function parseAisMessage(message: unknown, receivedAt: number): VesselUpdate | null {
  if (!message || typeof message !== 'object') return null;
  const envelope = message as RawEnvelope;
  const type = envelope.MessageType;
  if (!type || !envelope.Message) return null;
  const body = envelope.Message[type] as RawPosition & RawStatic | undefined;
  if (!body || typeof body !== 'object') return null;
  const meta = envelope.MetaData;
  const mmsi = mmsiOf(meta, body);
  if (mmsi === null) return null;
  const metaName = cleanAisText(meta?.ShipName);

  if (type === 'PositionReport' || type === 'StandardClassBPositionReport') {
    if (body.Valid === false) return null;
    const position = validPosition(body.Latitude, body.Longitude);
    if (!position) return null;
    const classB = type === 'StandardClassBPositionReport';
    return {
      mmsi,
      at: receivedAt,
      kind: 'position',
      aisClass: classB ? 'B' : 'A',
      name: metaName || undefined,
      position,
      sogKn: speedKnots(body.Sog),
      cogDeg: courseDegrees(body.Cog),
      headingDeg: headingDegrees(body.TrueHeading),
      navStatus: classB ? NAV_STATUS_UNDEFINED : (isWhole(body.NavigationalStatus) ? body.NavigationalStatus : NAV_STATUS_UNDEFINED),
    };
  }

  if (type === 'ShipStaticData') {
    if (body.Valid === false) return null;
    const name = cleanAisText(body.Name) || metaName;
    return {
      mmsi,
      at: receivedAt,
      kind: 'static',
      aisClass: 'A',
      name: name || undefined,
      metaPosition: validPosition(meta?.latitude, meta?.longitude) ?? undefined,
      shipType: isWhole(body.Type) ? body.Type : 0,
      lengthM: dimension(body.Dimension?.A, body.Dimension?.B),
      beamM: dimension(body.Dimension?.C, body.Dimension?.D),
      destination: cleanAisText(body.Destination),
      etaReported: parseEta(body.Eta, receivedAt),
    };
  }

  return null;
}

export function shiftUpdate(update: VesselUpdate, offsetMs: number): VesselUpdate {
  const shifted: VesselUpdate = { ...update, at: update.at + offsetMs };
  if (update.etaReported) shifted.etaReported = new Date(Date.parse(update.etaReported) + offsetMs).toISOString();
  return shifted;
}

interface VesselRecord {
  mmsi: number;
  aisClass: AisClass;
  name: string;
  lat: number | null;
  lon: number | null;
  positionAt: number | null;
  positionFromMeta: boolean;
  sogKn: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  navStatus: number;
  shipType: number;
  lengthM: number | null;
  beamM: number | null;
  destination: string;
  etaReported: string | null;
  lastSeen: number;
  source: DataSource;
}

export interface VesselTable {
  apply(update: VesselUpdate, source: DataSource): boolean;
  ingest(message: unknown, receivedAt: number, source: DataSource): boolean;
  vessels(now?: number): AisVessel[];
  get(mmsi: number, now?: number): AisVessel | null;
  prune(now?: number): number;
  clear(): void;
  readonly size: number;
}

function blankRecord(mmsi: number, update: VesselUpdate, source: DataSource): VesselRecord {
  return {
    mmsi,
    aisClass: update.aisClass ?? 'A',
    name: '',
    lat: null,
    lon: null,
    positionAt: null,
    positionFromMeta: false,
    sogKn: null,
    cogDeg: null,
    headingDeg: null,
    navStatus: NAV_STATUS_UNDEFINED,
    shipType: 0,
    lengthM: null,
    beamM: null,
    destination: '',
    etaReported: null,
    lastSeen: update.at,
    source,
  };
}

function toVessel(record: VesselRecord): AisVessel {
  return {
    mmsi: record.mmsi,
    name: record.name || `MMSI ${record.mmsi}`,
    lat: record.lat as number,
    lon: record.lon as number,
    sogKn: record.sogKn,
    cogDeg: record.cogDeg,
    headingDeg: record.headingDeg,
    navStatus: navStatusFor(record.navStatus),
    shipType: record.shipType,
    typeLabel: shipTypeLabel(record.shipType),
    lengthM: record.lengthM,
    beamM: record.beamM,
    destination: record.destination,
    etaReported: record.etaReported,
    aisClass: record.aisClass,
    lastSeen: record.lastSeen,
    source: record.source,
  };
}

export function createVesselTable(settings: { ais: { staleMinutes: number } }): VesselTable {
  const records = new Map<number, VesselRecord>();
  const staleMs = () => settings.ais.staleMinutes * 60_000;

  const isVisible = (record: VesselRecord, now: number) =>
    record.positionAt !== null && record.lat !== null && record.lon !== null && now - record.positionAt <= staleMs();

  function apply(update: VesselUpdate, source: DataSource): boolean {
    let record = records.get(update.mmsi);
    if (!record) {
      record = blankRecord(update.mmsi, update, source);
      records.set(update.mmsi, record);
    }
    record.lastSeen = Math.max(record.lastSeen, update.at);
    record.source = source;
    if (update.name) record.name = update.name;
    if (update.kind === 'position' && update.position) {
      if (record.positionAt !== null && !record.positionFromMeta && update.at < record.positionAt) return false;
      if (update.aisClass) record.aisClass = update.aisClass;
      record.lat = update.position.lat;
      record.lon = update.position.lon;
      record.positionAt = update.at;
      record.positionFromMeta = false;
      record.sogKn = update.sogKn ?? null;
      record.cogDeg = update.cogDeg ?? null;
      record.headingDeg = update.headingDeg ?? null;
      record.navStatus = update.navStatus ?? NAV_STATUS_UNDEFINED;
      return true;
    }
    if (update.kind === 'static') {
      if (update.aisClass) record.aisClass = update.aisClass;
      if (update.shipType !== undefined) record.shipType = update.shipType;
      if (update.lengthM !== undefined) record.lengthM = update.lengthM;
      if (update.beamM !== undefined) record.beamM = update.beamM;
      if (update.destination !== undefined) record.destination = update.destination;
      if (update.etaReported !== undefined) record.etaReported = update.etaReported;
      if (update.metaPosition && (record.positionAt === null || record.positionFromMeta)) {
        record.lat = update.metaPosition.lat;
        record.lon = update.metaPosition.lon;
        record.positionAt = update.at;
        record.positionFromMeta = true;
      }
      return record.positionAt !== null;
    }
    return false;
  }

  function prune(now = Date.now()): number {
    let removed = 0;
    for (const [mmsi, record] of records) {
      const newest = Math.max(record.lastSeen, record.positionAt ?? 0);
      const positionStale = record.positionAt !== null && now - record.positionAt > staleMs();
      if (now - newest > staleMs() || positionStale) {
        records.delete(mmsi);
        removed++;
      }
    }
    return removed;
  }

  return {
    apply,
    ingest(message, receivedAt, source) {
      const update = parseAisMessage(message, receivedAt);
      return update ? apply(update, source) : false;
    },
    vessels(now = Date.now()) {
      const out: AisVessel[] = [];
      for (const record of records.values()) if (isVisible(record, now)) out.push(toVessel(record));
      return out.sort((a, b) => a.mmsi - b.mmsi);
    },
    get(mmsi, now = Date.now()) {
      const record = records.get(mmsi);
      return record && isVisible(record, now) ? toVessel(record) : null;
    },
    prune,
    clear() {
      records.clear();
    },
    get size() {
      return records.size;
    },
  };
}
