import { getJson, type FetchContext } from './http';
import type { AdvisoryView } from '../../src/shared/protocol';

export const NWS_API = 'https://api.weather.gov';
const GEO_JSON = 'application/geo+json';
const VTEC = /^\/[OTEX]\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\./;
const ENDED_ACTIONS = new Set(['CAN', 'EXP', 'UPG']);

export type NwsAdvisory = Omit<AdvisoryView, 'endsLabel' | 'relayedBy' | 'relayedAtLabel'>;

export interface ZoneForecast { issuedAt: string | null; periods: { name: string; text: string }[] }

interface AlertProperties {
  id?: string;
  event?: string;
  headline?: string | null;
  description?: string | null;
  instruction?: string | null;
  severity?: string;
  status?: string;
  messageType?: string;
  onset?: string | null;
  ends?: string | null;
  expires?: string | null;
  sent?: string;
  areaDesc?: string;
  senderName?: string;
  parameters?: { VTEC?: string[]; NWSheadline?: string[]; eventEndingTime?: string[] };
}

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();

export function vtecParts(p: AlertProperties): { action: string; key: string } | null {
  const m = VTEC.exec(p.parameters?.VTEC?.[0] ?? '');
  return m ? { action: m[1], key: `${m[2]}.${m[3]}.${m[4]}.${m[5]}` } : null;
}

export function advisoryKey(p: AlertProperties): string {
  return vtecParts(p)?.key ?? p.id ?? `${p.event ?? 'alert'}:${p.onset ?? p.sent ?? ''}`;
}

export function descriptionPart(description: string, label: string): string | null {
  const m = new RegExp(`\\*\\s*${label}\\.\\.\\.([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\*|$)`).exec(description);
  return m ? oneLine(m[1]) : null;
}

export function advisorySummary(p: AlertProperties): string {
  const description = p.description ?? '';
  const parts = [descriptionPart(description, 'WHAT'), descriptionPart(description, 'IMPACTS')].filter((x): x is string => !!x);
  if (parts.length) return parts.join(' ');
  if (p.instruction) return oneLine(p.instruction);
  return oneLine(p.headline ?? p.event ?? 'NWS alert');
}

function endsOf(p: AlertProperties): string | null {
  return p.ends ?? p.parameters?.eventEndingTime?.[0] ?? null;
}

export function parseAlerts(body: unknown, now: number): NwsAdvisory[] {
  const features = ((body ?? {}) as { features?: { properties?: AlertProperties }[] }).features ?? [];
  const byKey = new Map<string, NwsAdvisory>();
  for (const f of features) {
    const p = f.properties;
    if (!p?.event || p.status !== 'Actual' || p.messageType === 'Cancel') continue;
    const vtec = vtecParts(p);
    if (vtec && ENDED_ACTIONS.has(vtec.action)) continue;
    const ends = endsOf(p);
    const until = ends ?? p.expires ?? null;
    if (until && Date.parse(until) <= now) continue;
    const advisory: NwsAdvisory = {
      id: advisoryKey(p),
      event: p.event,
      headline: oneLine(p.headline ?? p.parameters?.NWSheadline?.[0] ?? p.event),
      summary: advisorySummary(p),
      severity: p.severity ?? 'Unknown',
      onset: p.onset ?? null,
      ends,
      areaDesc: oneLine(p.areaDesc ?? ''),
      instruction: p.instruction ? oneLine(p.instruction) : null,
      sender: p.senderName ?? 'NWS',
      sentAt: p.sent ?? new Date(now).toISOString(),
    };
    const prior = byKey.get(advisory.id);
    if (!prior || Date.parse(advisory.sentAt) > Date.parse(prior.sentAt)) byKey.set(advisory.id, advisory);
  }
  return [...byKey.values()].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
}

export function parseZoneForecast(body: unknown, count: number, now: number): ZoneForecast | null {
  const props = ((body ?? {}) as { properties?: { updated?: string; periods?: { name?: string; detailedForecast?: string }[] } }).properties;
  const periods = (props?.periods ?? [])
    .filter((p) => p.name && p.detailedForecast)
    .slice(0, count)
    .map((p) => ({ name: String(p.name), text: oneLine(String(p.detailedForecast)) }));
  if (!periods.length) return null;
  const updated = props?.updated && Date.parse(props.updated) <= now ? props.updated : null;
  return { issuedAt: updated, periods };
}

export async function fetchAlerts(ctx: FetchContext, zones: string[]): Promise<NwsAdvisory[]> {
  const body = await getJson(ctx, `${NWS_API}/alerts/active?zone=${zones.map(encodeURIComponent).join(',')}`, GEO_JSON);
  return parseAlerts(body, ctx.now);
}

export async function fetchZoneForecast(ctx: FetchContext, zone: string, count: number): Promise<ZoneForecast> {
  const body = await getJson(ctx, `${NWS_API}/zones/forecast/${encodeURIComponent(zone)}/forecast`, GEO_JSON);
  const forecast = parseZoneForecast(body, count, ctx.now);
  if (!forecast) throw new Error('sent a forecast with no periods');
  return forecast;
}
