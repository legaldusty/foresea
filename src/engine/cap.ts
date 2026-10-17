import type { Settings } from './settings';
import type { LonLat } from './geo';

export type FeedPriority = 'P1' | 'P2' | 'P3' | 'P4';

export interface PublicZone {
  noticeId: string;
  kind: 'keepOut' | 'slow';
  reason: string;
  instruction: string;
  priority: FeedPriority;
  place: string;
  sentWall: string;
  expiresWall: string;
  rings: LonLat[][][];
  radiusM: number;
  slowKnots: number | null;
}

export interface CapGrade { urgency: string; severity: string; certainty: string }

export interface FeedOptions {
  mode: 'live' | 'sim';
  sender: string;
  senderName: string;
  language: string;
  category: string;
  polygonDecimals: number;
  byPriority: Record<FeedPriority, CapGrade>;
  responseByZone: Record<PublicZone['kind'], string>;
  baseUrl: string | null;
  nowWall: string;
}

export interface ZoneFeature {
  type: 'Feature';
  id: string;
  properties: {
    noticeId: string; status: string; kind: PublicZone['kind']; reason: string; instruction: string; priority: FeedPriority;
    place: string; sent: string; expires: string; radiusM: number; slowKnots: number | null;
  };
  geometry: { type: 'MultiPolygon'; coordinates: LonLat[][][] };
}

export interface ZoneCollection { type: 'FeatureCollection'; features: ZoneFeature[] }

export const CAP_NAMESPACE = 'urn:oasis:names:tc:emergency:cap:1.2';
const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const STRAIGHT_EPSILON = 1e-12;

export function feedOptions(settings: Settings, extra: Pick<FeedOptions, 'mode' | 'senderName' | 'baseUrl' | 'nowWall'>): FeedOptions {
  const f = settings.feeds;
  return {
    ...extra, sender: f.capSender, language: f.capLanguage, category: f.category, polygonDecimals: f.polygonDecimals,
    byPriority: f.byPriority, responseByZone: f.responseByZone,
  };
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function capTime(iso: string): string {
  const ms = Date.parse(iso);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  return `${d.toISOString().slice(0, 19)}+00:00`;
}

export function capStatus(mode: FeedOptions['mode']): 'Actual' | 'Exercise' {
  return mode === 'live' ? 'Actual' : 'Exercise';
}

function dropStraight(points: LonLat[]): LonLat[] {
  if (points.length <= 4) return points;
  const out: LonLat[] = [points[0]];
  for (let k = 1; k < points.length - 1; k++) {
    const a = out[out.length - 1], b = points[k], c = points[k + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > STRAIGHT_EPSILON) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function closedRing(ring: LonLat[], decimals: number): LonLat[] {
  const round = (v: number) => Number(v.toFixed(decimals));
  const out: LonLat[] = [];
  for (const [lon, lat] of dropStraight(ring)) {
    const p: LonLat = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out;
}

export function outerRings(rings: LonLat[][][], decimals: number): LonLat[][] {
  return rings.map((poly) => closedRing(poly[0] ?? [], decimals)).filter((ring) => ring.length >= 4);
}

export function capPolygon(ring: LonLat[], decimals: number): string {
  return ring.map(([lon, lat]) => `${lat.toFixed(decimals)},${lon.toFixed(decimals)}`).join(' ');
}

function headline(z: PublicZone): string {
  return `${z.reason} near ${z.place}: ${z.instruction}`;
}

function capIdentifier(z: PublicZone, o: FeedOptions): string {
  const sent = Date.parse(z.sentWall);
  return `${o.sender}-${z.noticeId}-${Number.isFinite(sent) ? sent : 0}`;
}

function el(name: string, text: string | number): string {
  return `<${name}>${xmlEscape(String(text))}</${name}>`;
}

export function capAlert(z: PublicZone, o: FeedOptions, declaration = true): string {
  const grade = o.byPriority[z.priority];
  const status = capStatus(o.mode);
  const until = capTime(z.expiresWall);
  const description = `${z.reason} near ${z.place}. ${z.instruction}. Published by a harbor officer. Valid until ${until.slice(11, 16)} UTC.`;
  const polygons = outerRings(z.rings, o.polygonDecimals).map((ring) => el('polygon', capPolygon(ring, o.polygonDecimals)));
  const lines = [
    `<alert xmlns="${CAP_NAMESPACE}">`,
    el('identifier', capIdentifier(z, o)),
    el('sender', o.sender),
    el('sent', capTime(z.sentWall)),
    el('status', status),
    el('msgType', 'Alert'),
    el('scope', 'Public'),
    ...(status === 'Exercise' ? [el('note', 'Exercise from the Foresea simulation. Not a real notice.')] : []),
    '<info>',
    el('language', o.language),
    el('category', o.category),
    el('event', z.reason),
    el('responseType', o.responseByZone[z.kind]),
    el('urgency', grade.urgency),
    el('severity', grade.severity),
    el('certainty', grade.certainty),
    el('expires', until),
    el('senderName', o.senderName),
    el('headline', headline(z)),
    el('description', description),
    el('instruction', z.instruction),
    ...(o.baseUrl ? [el('web', `${o.baseUrl}/captain`)] : []),
    `<parameter>${el('valueName', 'GIVEWAY_PRIORITY')}${el('value', z.priority)}</parameter>`,
    '<area>',
    el('areaDesc', `${z.reason} near ${z.place}`),
    ...polygons,
    '</area>',
    '</info>',
    '</alert>',
  ];
  return `${declaration ? `${XML_DECLARATION}\n` : ''}${lines.join('\n')}\n`;
}

export function capFeed(zones: PublicZone[], o: FeedOptions): string {
  const link = (rel: string, href: string, type: string) => `<link rel="${rel}" type="${type}" href="${xmlEscape(href)}"/>`;
  const entries = zones.map((z) => [
    '<entry>',
    el('id', `urn:giveway:cap:${capIdentifier(z, o)}`),
    el('title', headline(z)),
    el('updated', capTime(z.sentWall)),
    ...(o.baseUrl ? [link('alternate', `${o.baseUrl}/api/cap/${encodeURIComponent(z.noticeId)}.xml`, 'application/cap+xml')] : []),
    `<content type="application/cap+xml">${capAlert(z, o, false)}</content>`,
    '</entry>',
  ].join('\n'));
  return [
    XML_DECLARATION,
    `<feed xmlns="${ATOM_NAMESPACE}">`,
    el('id', `urn:giveway:cap:${o.sender}`),
    el('title', `${o.senderName} notices`),
    el('subtitle', `Active published notices as CAP 1.2 alerts, status ${capStatus(o.mode)}`),
    el('updated', capTime(o.nowWall)),
    `<author>${el('name', o.senderName)}</author>`,
    ...(o.baseUrl ? [link('self', `${o.baseUrl}/api/cap.xml`, 'application/atom+xml')] : []),
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

export function zonesGeoJson(zones: PublicZone[], o: Pick<FeedOptions, 'mode' | 'polygonDecimals'>): ZoneCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      id: z.noticeId,
      properties: {
        noticeId: z.noticeId, status: capStatus(o.mode), kind: z.kind, reason: z.reason, instruction: z.instruction, priority: z.priority,
        place: z.place, sent: capTime(z.sentWall), expires: capTime(z.expiresWall), radiusM: z.radiusM, slowKnots: z.slowKnots,
      },
      geometry: { type: 'MultiPolygon', coordinates: z.rings.map((poly) => poly.map((ring) => closedRing(ring, o.polygonDecimals)).filter((ring) => ring.length >= 4)).filter((poly) => poly.length) },
    })),
  };
}
