import { describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld } from '../src/engine/world';
import { capAlert, capFeed, capStatus, capTime, feedOptions, zonesGeoJson, CAP_NAMESPACE, type FeedOptions, type PublicZone } from '../src/engine/cap';

const harbor = buildHarbor(gridJson as never, defaultSettings);
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
const ATTRS = /^(?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<&]*(?:&(?:amp|lt|gt|quot|apos);[^"<&]*)*"|'[^'<&]*'))*\s*$/;

function wellFormed(xml: string): { ok: boolean; error?: string; root?: string } {
  const body = xml.replace(/^<\?xml[^?]*\?>/, '');
  const stack: string[] = [];
  let root: string | undefined;
  let closedRoot = false;
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    const text = body.slice(i, lt < 0 ? body.length : lt);
    for (let k = text.indexOf('&'); k >= 0; k = text.indexOf('&', k + 1)) if (!ENTITY.test(text.slice(k))) return { ok: false, error: `bare & in "${text.slice(k, k + 12)}"` };
    if ((stack.length === 0) && text.trim()) return { ok: false, error: `text outside the root: "${text.trim().slice(0, 20)}"` };
    if (lt < 0) break;
    const gt = body.indexOf('>', lt);
    if (gt < 0) return { ok: false, error: 'unclosed tag' };
    const tag = body.slice(lt + 1, gt);
    const m = /^(\/?)([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)$/.exec(tag);
    if (!m) return { ok: false, error: `bad tag <${tag}>` };
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      if (attrs.trim()) return { ok: false, error: `attributes on a closing tag </${name}>` };
      if (stack.pop() !== name) return { ok: false, error: `mismatched </${name}>` };
      if (!stack.length) closedRoot = true;
    } else {
      if (!ATTRS.test(attrs)) return { ok: false, error: `bad attributes on <${name}>` };
      if (!stack.length) {
        if (closedRoot) return { ok: false, error: 'two root elements' };
        root = name;
      }
      if (!selfClosing) stack.push(name);
      else if (!stack.length) closedRoot = true;
    }
    i = gt + 1;
  }
  if (stack.length) return { ok: false, error: `unclosed <${stack[stack.length - 1]}>` };
  return { ok: !!root, root };
}

function textOf(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => m[1]);
}

const square: PublicZone = {
  noticeId: 'n-4', kind: 'keepOut', reason: 'Security zone', instruction: 'KEEP 500 m CLEAR', priority: 'P2', place: 'Pier 400 & the Fuel Pier',
  sentWall: '2026-10-17T09:14:05.123Z', expiresWall: '2026-10-17T09:44:05.000Z',
  rings: [[[[-118.22, 33.75], [-118.21, 33.75], [-118.21, 33.755], [-118.22, 33.755], [-118.22, 33.75]]]], radiusM: 500, slowKnots: null,
};

function options(mode: FeedOptions['mode']): FeedOptions {
  return feedOptions(defaultSettings, { mode, senderName: 'Los Angeles Harbor Watch', baseUrl: 'http://hub.local:5170', nowWall: '2026-10-17T09:15:00.000Z' });
}

describe('CAP builder', () => {
  it('has a checker that catches broken XML', () => {
    expect(wellFormed('<a><b></a>').ok).toBe(false);
    expect(wellFormed('<a>Pier & dock</a>').ok).toBe(false);
    expect(wellFormed('<a x=1></a>').ok).toBe(false);
    expect(wellFormed('<a></a><b></b>').ok).toBe(false);
    expect(wellFormed('<a><b/>text &amp; more</a>')).toEqual({ ok: true, root: 'a' });
  });

  it('writes a well-formed CAP 1.2 alert with the required elements', () => {
    const xml = capAlert(square, options('live'));
    const check = wellFormed(xml);
    expect(check).toEqual({ ok: true, root: 'alert' });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<alert xmlns="${CAP_NAMESPACE}">`);
    for (const name of ['identifier', 'sender', 'sent', 'status', 'msgType', 'scope', 'language', 'category', 'event', 'urgency', 'severity', 'certainty', 'expires', 'instruction', 'areaDesc', 'polygon']) {
      expect(textOf(xml, name).length, name).toBeGreaterThan(0);
    }
    const order = ['identifier', 'sender', 'sent', 'status', 'msgType', 'scope', 'info'].map((n) => xml.indexOf(`<${n}>`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const infoOrder = ['language', 'category', 'event', 'responseType', 'urgency', 'severity', 'certainty', 'expires', 'senderName', 'headline', 'description', 'instruction', 'web', 'parameter', 'area'].map((n) => xml.indexOf(`<${n}>`));
    expect([...infoOrder].sort((a, b) => a - b)).toEqual(infoOrder);
    expect(textOf(xml, 'status')).toEqual(['Actual']);
    expect(textOf(xml, 'scope')).toEqual(['Public']);
    expect(textOf(xml, 'category')).toEqual(['Safety']);
    expect(textOf(xml, 'event')).toEqual(['Security zone']);
    expect(textOf(xml, 'instruction')).toEqual(['KEEP 500 m CLEAR']);
    expect(textOf(xml, 'urgency')).toEqual(['Expected']);
    expect(textOf(xml, 'severity')).toEqual(['Moderate']);
    expect(textOf(xml, 'certainty')).toEqual(['Likely']);
    expect(textOf(xml, 'sent')).toEqual(['2026-10-17T09:14:05+00:00']);
    expect(textOf(xml, 'expires')).toEqual(['2026-10-17T09:44:05+00:00']);
    expect(xml).toContain('Pier 400 &amp; the Fuel Pier');
  });

  it('closes each polygon with lat,lon pairs', () => {
    const [polygon] = textOf(capAlert(square, options('live')), 'polygon');
    const pairs = polygon.split(' ');
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    expect(pairs[0]).toBe(pairs[pairs.length - 1]);
    for (const pair of pairs) {
      const [lat, lon] = pair.split(',').map(Number);
      expect(lat).toBeGreaterThan(33);
      expect(lon).toBeLessThan(-118);
    }
  });

  it('says Exercise in Simulation mode and Actual in Live mode', () => {
    expect(capStatus('sim')).toBe('Exercise');
    const xml = capAlert(square, options('sim'));
    expect(textOf(xml, 'status')).toEqual(['Exercise']);
    expect(textOf(xml, 'note')[0]).toMatch(/Exercise/);
    expect(textOf(capAlert(square, options('live')), 'note')).toEqual([]);
  });

  it('maps every priority to CAP urgency, severity and certainty', () => {
    const seen = (['P1', 'P2', 'P3', 'P4'] as const).map((priority) => {
      const xml = capAlert({ ...square, priority }, options('live'));
      return [textOf(xml, 'urgency')[0], textOf(xml, 'severity')[0], textOf(xml, 'certainty')[0]];
    });
    expect(seen[0]).toEqual(['Immediate', 'Severe', 'Observed']);
    for (const [urgency, severity, certainty] of seen) {
      expect(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']).toContain(urgency);
      expect(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']).toContain(severity);
      expect(['Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown']).toContain(certainty);
    }
  });

  it('wraps alerts in a well-formed Atom feed, empty when nothing is published', () => {
    const empty = capFeed([], options('sim'));
    expect(wellFormed(empty)).toEqual({ ok: true, root: 'feed' });
    const two = capFeed([square, { ...square, noticeId: 'n-5', kind: 'slow', reason: 'Whale nearby', instruction: 'SLOW TO 10 KNOTS', priority: 'P4' }], options('sim'));
    expect(wellFormed(two)).toEqual({ ok: true, root: 'feed' });
    expect(two.match(/<alert xmlns=/g)?.length).toBe(2);
    expect(two).toContain('href="http://hub.local:5170/api/cap/n-5.xml"');
  });

  it('uses CAP time with a numeric offset, never Z', () => {
    expect(capTime('2026-10-17T09:14:05.999Z')).toBe('2026-10-17T09:14:05+00:00');
  });
});

describe('published notices out to CAP and GeoJSON', () => {
  it('feeds a published security notice with public words only', () => {
    const w = createWorld({ harbor, settings: defaultSettings });
    w.resetHarbor('night');
    const c = w.spawn({ preset: 'driven' })!;
    const fuel = harbor.targets.find((t) => t.id === 'fuel')!;
    w.drive(c.id, [fuel.lon, fuel.lat]);
    for (let i = 0; i < 4000 && w.drafts.size === 0; i++) w.tick(250, 1_800_000_000_000 + i * 250);
    expect(w.drafts.size).toBeGreaterThan(0);
    expect(w.publicZones()).toEqual([]);
    const noticeId = w.publish([...w.drafts.keys()][0])!;
    const zones = w.publicZones();
    expect(zones.map((z) => z.noticeId)).toEqual([noticeId]);
    expect(zones[0].reason).toBe('Security zone');

    const o = feedOptions(defaultSettings, { mode: w.mode, senderName: w.station, baseUrl: null, nowWall: new Date().toISOString() });
    const feed = capFeed(zones, o);
    expect(wellFormed(feed)).toEqual({ ok: true, root: 'feed' });
    const alert = capAlert(zones[0], o);
    expect(wellFormed(alert)).toEqual({ ok: true, root: 'alert' });
    expect(textOf(alert, 'status')).toEqual(['Exercise']);
    expect(textOf(alert, 'event')).toEqual(['Security zone']);
    expect(textOf(alert, 'polygon').length).toBeGreaterThan(0);
    const risk = w.commandSnapshot().contacts[0].risk!;
    for (const text of [feed, alert]) {
      expect(text).not.toMatch(/drone/i);
      expect(text).not.toMatch(/risk|hostil|odds/i);
      expect(text).not.toContain(`>${risk.score}<`);
    }

    const geo = zonesGeoJson(zones, { mode: w.mode, polygonDecimals: defaultSettings.feeds.polygonDecimals });
    expect(geo.features).toHaveLength(1);
    expect(Object.keys(geo.features[0].properties).sort()).toEqual(['expires', 'instruction', 'kind', 'noticeId', 'place', 'priority', 'radiusM', 'reason', 'sent', 'slowKnots', 'status'].sort());
    expect(geo.features[0].properties.status).toBe('Exercise');
    const ring = geo.features[0].geometry.coordinates[0][0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(JSON.stringify(geo)).not.toMatch(/drone|risk|odds/i);
  });
});
