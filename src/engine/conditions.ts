import type * as P from '../shared/protocol';
import { nextSunEvents } from './sun';

const MINUTE_MS = 60_000;
const SUN_SOURCE = 'Computed for the harbor';

export interface BulletinRec {
  id: string;
  advisoryId: string;
  title: string;
  detail: string;
  until: string | null;
  relayedBy: string;
  relayedAtMs: number;
}

export interface ConditionsContext { nowMs: number; timeZone: string; lonlat: [number, number]; bulletins: BulletinRec[] }

export function emptyConditions(detail = 'Starting'): P.ConditionsView {
  return {
    datum: 'MLLW', waterLevelM: null, tideTrend: null, nextHigh: null, nextLow: null, windMps: null, gustMps: null, windFromDeg: null,
    waveHeightM: null, wavePeriodS: null, waveFromDeg: null, waterTempC: null, airTempC: null, pressureHpa: null,
    sunrise: null, sunset: null, advisories: null, forecast: null,
    missing: { advisories: detail, forecast: detail },
    sources: [],
  };
}

export function ageMinutes(observedAt: string | null, nowMs: number): number | null {
  if (!observedAt) return null;
  const t = Date.parse(observedAt);
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / MINUTE_MS) : null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(ms: number, timeZone: string): { day: string; weekday: string; clock: string } {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday'), clock: `${get('hour')}:${get('minute')}` };
}

export function wallClockLabel(ms: number, nowMs: number, timeZone: string): string {
  const at = localParts(ms, timeZone);
  return at.day === localParts(nowMs, timeZone).day ? at.clock : `${at.weekday} ${at.clock}`;
}

function isoLabel(iso: string | null, nowMs: number, timeZone: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? wallClockLabel(t, nowMs, timeZone) : null;
}

function aged<T>(s: P.Sourced<T> | null, nowMs: number): P.Sourced<T> | null {
  return s ? { ...s, ageMin: ageMinutes(s.observedAt, nowMs) ?? s.ageMin } : null;
}

function upcomingTurn(s: P.Sourced<P.TideTurnView> | null, ctx: ConditionsContext): P.Sourced<P.TideTurnView> | null {
  if (!s || Date.parse(s.value.at) <= ctx.nowMs) return null;
  return { ...s, ageMin: ageMinutes(s.observedAt, ctx.nowMs) ?? s.ageMin, value: { ...s.value, label: wallClockLabel(Date.parse(s.value.at), ctx.nowMs, ctx.timeZone) } };
}

export function advisoryActive(a: P.AdvisoryView, nowMs: number): boolean {
  return !a.ends || Date.parse(a.ends) > nowMs;
}

export function activeAdvisories(view: P.ConditionsView, nowMs: number): P.AdvisoryView[] {
  return (view.advisories?.value ?? []).filter((a) => advisoryActive(a, nowMs));
}

function sunEvent(ms: number | null, ctx: ConditionsContext): P.Sourced<{ at: string; label: string }> | null {
  if (ms === null) return null;
  return { value: { at: new Date(ms).toISOString(), label: wallClockLabel(ms, ctx.nowMs, ctx.timeZone) }, source: SUN_SOURCE, observedAt: new Date(ctx.nowMs).toISOString(), ageMin: 0 };
}

export function conditionsAt(view: P.ConditionsView, ctx: ConditionsContext): P.ConditionsView {
  const now = ctx.nowMs;
  const sun = nextSunEvents(now, ctx.lonlat[1], ctx.lonlat[0]);
  const advisories = view.advisories
    ? {
      ...view.advisories,
      ageMin: ageMinutes(view.advisories.observedAt, now) ?? view.advisories.ageMin,
      value: activeAdvisories(view, now).map((a) => {
        const relayed = ctx.bulletins.find((b) => b.advisoryId === a.id);
        return { ...a, endsLabel: isoLabel(a.ends, now, ctx.timeZone), relayedBy: relayed?.relayedBy ?? null, relayedAtLabel: relayed ? wallClockLabel(relayed.relayedAtMs, now, ctx.timeZone) : null };
      }),
    }
    : null;
  return {
    ...view,
    waterLevelM: aged(view.waterLevelM, now), tideTrend: aged(view.tideTrend, now),
    nextHigh: upcomingTurn(view.nextHigh, ctx), nextLow: upcomingTurn(view.nextLow, ctx),
    windMps: aged(view.windMps, now), gustMps: aged(view.gustMps, now), windFromDeg: aged(view.windFromDeg, now),
    waveHeightM: aged(view.waveHeightM, now), wavePeriodS: aged(view.wavePeriodS, now), waveFromDeg: aged(view.waveFromDeg, now),
    waterTempC: aged(view.waterTempC, now), airTempC: aged(view.airTempC, now), pressureHpa: aged(view.pressureHpa, now),
    sunrise: sunEvent(sun.sunriseMs, ctx), sunset: sunEvent(sun.sunsetMs, ctx),
    advisories,
    forecast: aged(view.forecast, now),
    sources: view.sources.map((s) => ({ ...s, ageMin: ageMinutes(s.observedAt, now) })),
  };
}

export function captainConditions(view: P.ConditionsView): P.CaptainConditions {
  const nextTide = [view.nextHigh, view.nextLow].filter((t): t is P.Sourced<P.TideTurnView> => t !== null).sort((a, b) => Date.parse(a.value.at) - Date.parse(b.value.at))[0] ?? null;
  return {
    wind: view.windMps ? { speedMps: view.windMps.value, gustMps: view.gustMps?.value ?? null, fromDeg: view.windFromDeg?.value ?? null, source: view.windMps.source, ageMin: view.windMps.ageMin } : null,
    waves: view.waveHeightM ? { heightM: view.waveHeightM.value, periodS: view.wavePeriodS?.value ?? null, source: view.waveHeightM.source, ageMin: view.waveHeightM.ageMin } : null,
    nextTide: nextTide ? { kind: nextTide.value.kind, label: nextTide.value.label, meters: nextTide.value.meters, source: nextTide.source } : null,
  };
}

export function bulletinActive(b: BulletinRec, nowMs: number): boolean {
  return !b.until || Date.parse(b.until) > nowMs;
}

export function captainBulletins(bulletins: BulletinRec[], nowMs: number, timeZone: string): P.CaptainBulletin[] {
  return bulletins.filter((b) => bulletinActive(b, nowMs)).map((b) => ({
    id: b.id, title: b.title, detail: b.detail, until: b.until, untilLabel: isoLabel(b.until, nowMs, timeZone), source: 'NWS',
    relayedBy: b.relayedBy, relayedAtLabel: wallClockLabel(b.relayedAtMs, nowMs, timeZone),
  }));
}

export function bulletinFor(a: P.AdvisoryView, officer: string, nowMs: number): BulletinRec {
  return { id: `bulletin-${a.id}`, advisoryId: a.id, title: `NWS ${a.event}`, detail: a.summary, until: a.ends, relayedBy: officer, relayedAtMs: nowMs };
}

function untilPhrase(a: P.AdvisoryView, nowMs: number, timeZone: string): string {
  const label = isoLabel(a.ends, nowMs, timeZone);
  return label ? ` until ${label}` : '';
}

export function advisoryCard(a: P.AdvisoryView, nowMs: number, timeZone: string): { title: string; body: string; facts: string[] } {
  const sent = isoLabel(a.sentAt, nowMs, timeZone);
  return {
    title: `NWS ${a.event}${untilPhrase(a, nowMs, timeZone)}. Relay it to every captain?`,
    body: `${a.summary} Captains get it as a bulletin with a quiet P3 push. Nothing closes.`,
    facts: [`${a.sender}${sent ? `, sent ${sent}` : ''}`, `Severity ${a.severity.toLowerCase()}`, a.areaDesc],
  };
}

export function advisorySentence(a: P.AdvisoryView, nowMs: number, timeZone: string): string {
  return `NWS ${a.event}${untilPhrase(a, nowMs, timeZone)}.`;
}

export function advisoryReportLine(a: P.AdvisoryView, relayed: BulletinRec | undefined, nowMs: number, timeZone: string): string {
  const relay = relayed ? `relayed to captains by ${relayed.relayedBy} at ${wallClockLabel(relayed.relayedAtMs, nowMs, timeZone)}` : 'not relayed to captains';
  return `NWS ${a.event} in effect${untilPhrase(a, nowMs, timeZone)}, ${relay}.`;
}
