import type { AuditEntry, IncidentReport } from '../shared/protocol';
import { clockLabel } from './eta';

export interface IncidentRecord {
  contactId: string;
  label: string;
  simulated: boolean;
  source: string;
  firstSeenMin: number;
  firstPlace: string;
  readings: string;
  classification: string;
  hostility: number | null;
  callMin: number | null;
  callTarget: string | null;
  callOdds: number | null;
  callEtaMin: number | null;
  peakScore: number;
  peakLevel: string | null;
  peakAtMin: number | null;
  arrivedMin: number | null;
  arrivedAt: string | null;
  draftedMin: number | null;
  publishedMin: number | null;
  publishedBy: string | null;
  noticeIds: string[];
  instruction: string | null;
  clearedMin: number | null;
  closedMin: number | null;
}

export interface IncidentDelivery { noticeId: string; vesselName: string; priority: string; simulated: boolean; sentMin: number | null; ackMin: number | null; notResponding: boolean; vhfCalled: boolean }

export interface IncidentInputs {
  rec: IncidentRecord;
  audit: AuditEntry[];
  deliveries: IncidentDelivery[];
  delayBoatMin: number;
  station: string;
  nowMin: number;
}

function minutes(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.round((b - a) * 10) / 10;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mentions(e: AuditEntry, rec: IncidentRecord): boolean {
  if (e.where?.contactId === rec.contactId) return true;
  if (e.where?.zoneId === `z-${rec.contactId}`) return true;
  return new RegExp(`(^|[^A-Za-z0-9-])${rec.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`).test(e.detail);
}

export function buildIncidentReport(input: IncidentInputs): IncidentReport {
  const { rec } = input;
  const own = input.deliveries.filter((d) => rec.noticeIds.includes(d.noticeId));
  const phones = own.filter((d) => d.priority !== 'P4');
  const acked = phones.filter((d) => d.ackMin !== null);
  const ackSec = acked.map((d) => ((d.ackMin as number) - (d.sentMin ?? (d.ackMin as number))) * 60);
  const timeline = input.audit.filter((e) => e.atMin >= rec.firstSeenMin - 0.01 && mentions(e, rec));
  const machine = [...new Set(timeline.filter((e) => e.actor === 'machine').map((e) => e.action))];
  const people = [...new Set(timeline.filter((e) => e.actor !== 'machine' && e.actor !== 'system').map((e) => e.action))];
  const lead = rec.arrivedMin !== null ? minutes(rec.callMin, rec.arrivedMin) : rec.callEtaMin;
  const warned = rec.arrivedMin !== null ? minutes(rec.publishedMin, rec.arrivedMin) : null;
  return {
    contactId: rec.contactId,
    label: rec.label,
    simulated: rec.simulated,
    source: rec.source,
    status: rec.closedMin !== null ? 'closed' : rec.clearedMin !== null ? 'all clear' : 'open',
    station: input.station,
    detected: { atLabel: clockLabel(rec.firstSeenMin), place: rec.firstPlace, readings: rec.readings },
    classification: rec.classification,
    hostility: rec.hostility,
    call: rec.callMin !== null && rec.callTarget ? {
      atLabel: clockLabel(rec.callMin), target: rec.callTarget, odds: rec.callOdds ?? 0,
      afterDetectionMin: minutes(rec.firstSeenMin, rec.callMin) ?? 0,
    } : null,
    arrival: rec.arrivedMin !== null ? { atLabel: clockLabel(rec.arrivedMin), place: rec.arrivedAt ?? '', reached: true }
      : rec.callMin !== null && rec.callEtaMin !== null ? { atLabel: clockLabel(rec.callMin + rec.callEtaMin), place: rec.callTarget ?? '', reached: false } : null,
    leadMin: lead,
    peak: rec.peakLevel ? { score: rec.peakScore, level: rec.peakLevel, atLabel: clockLabel(rec.peakAtMin ?? rec.firstSeenMin) } : null,
    notice: rec.publishedMin !== null || rec.draftedMin !== null ? {
      draftedLabel: rec.draftedMin !== null ? clockLabel(rec.draftedMin) : null,
      publishedLabel: rec.publishedMin !== null ? clockLabel(rec.publishedMin) : null,
      publishedBy: rec.publishedBy,
      afterDetectionMin: minutes(rec.firstSeenMin, rec.publishedMin),
      warningBeforeArrivalMin: warned,
      instruction: rec.instruction,
    } : null,
    boats: {
      told: phones.length,
      p1: phones.filter((d) => d.priority === 'P1').length,
      p2: phones.filter((d) => d.priority === 'P2').length,
      acknowledged: acked.length,
      medianAckSec: median(ackSec),
      notResponding: phones.filter((d) => d.notResponding).map((d) => d.vesselName),
      vhfCalled: phones.filter((d) => d.vhfCalled).map((d) => d.vesselName),
      shipsByAis: own.filter((d) => d.priority === 'P4').length,
    },
    delayBoatMin: Math.round(input.delayBoatMin * 10) / 10,
    gatesClosed: 0,
    allClearLabel: rec.clearedMin !== null ? clockLabel(rec.clearedMin) : null,
    durationMin: minutes(rec.firstSeenMin, rec.clearedMin ?? rec.closedMin ?? input.nowMin) ?? 0,
    machineDid: machine,
    peopleDid: people,
    timeline: timeline.map((e) => ({ atLabel: clockLabel(e.atMin), actor: e.actor, action: e.action, detail: e.detail })),
  };
}
