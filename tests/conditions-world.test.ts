import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import settings from '../settings/giveway.settings.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld, type World } from '../src/engine/world';
import { createConditionsClient, type ConditionsSettings } from '../server/conditions/client';
import type { TextFetch } from '../server/conditions/http';
import type { ConditionsView } from '../src/shared/protocol';
import { repoPath } from './support';

const harbor = buildHarbor(gridJson as never, defaultSettings);
const NOW = Date.parse('2026-10-17T13:00:00Z');
const ADVISORY_ENDS = Date.parse('2026-10-17T21:00:00Z');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giveway-conditions-world-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const fixture = (name: string) => fs.readFileSync(repoPath(`tests/fixtures/${name}`), 'utf8');
const reply = (body: string, status = 200) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) });

function fetchFor(alerts: string): TextFetch {
  return (url) => {
    if (url.includes('/realtime2/')) return reply(fixture('ndbc-46222.txt'));
    if (url.includes('product=water_level')) return reply(fixture('coops-water-level-9410660.json'));
    if (url.includes('product=predictions')) return reply(fixture('coops-hilo-9410660.json'));
    if (url.includes('product=wind')) return reply(fixture('coops-wind-9410647.json'));
    if (url.includes('product=air_temperature')) return reply(fixture('coops-air-temperature-9410647.json'));
    if (url.includes('product=air_pressure')) return reply(fixture('coops-air-pressure-9410660.json'));
    if (url.includes('/alerts/active')) return reply(alerts);
    if (url.includes('/zones/forecast/')) return reply(fixture('nws-zone-forecast-pzz655.json'));
    return reply('', 404);
  };
}

const NO_ALERTS = JSON.stringify({ type: 'FeatureCollection', features: [] });

async function conditionsAt(now: number, alerts = fixture('nws-alerts-pzz655.json')): Promise<ConditionsView> {
  const client = createConditionsClient({ settings: settings as unknown as ConditionsSettings, fetch: fetchFor(alerts), cacheFile: path.join(dir, `cache-${now}.json`), now: () => now });
  await client.refresh();
  return client.view();
}

function liveWorld(): World {
  const w = createWorld({ harbor, settings: defaultSettings });
  w.tick(250, NOW);
  w.resetHarbor('live');
  w.tick(250, NOW);
  return w;
}

const advisoryCard = (w: World) => w.cards.find((k) => k.key === 'advisory:KLOX.SC.Y.0149');

describe('NWS advisories on the desk', () => {
  it('raises a card, relays a bulletin to every captain, and lets it expire at the advisory end', async () => {
    const w = liveWorld();
    w.captainJoin('ferry1');
    w.setConditions(await conditionsAt(NOW));

    const card = advisoryCard(w);
    expect(card?.title).toBe('NWS Small Craft Advisory until 14:00. Relay it to every captain?');
    expect(card?.actions.map((a) => a.id)).toEqual(['relay', 'dismiss']);
    expect(w.commandSnapshot().card?.title).toBe(card?.title);
    expect(w.captainSnapshot('ferry1').bulletins).toEqual([]);
    expect(w.dailyReport().lines).toContain('NWS Small Craft Advisory in effect until 14:00, not relayed to captains.');
    expect(w.headline().text).toContain('NWS Small Craft Advisory until 14:00.');

    w.drainEffects();
    w.cardAction(card!.id, 'relay');
    const fx = w.drainEffects();
    expect(fx.pushes).toEqual([expect.objectContaining({ vesselId: 'ferry1', priority: 'P3', title: 'NWS Small Craft Advisory until 14:00' })]);
    expect(fx.audit.find((a) => a.action === 'Advisory relayed')).toMatchObject({ actor: 'officer' });
    expect(fx.audit.find((a) => a.action === 'Advisory relayed')?.detail).toContain(`Relayed to every captain by ${w.officer}`);

    const bulletins = w.captainSnapshot('ferry1').bulletins;
    expect(bulletins).toEqual([{
      id: 'bulletin-KLOX.SC.Y.0149', title: 'NWS Small Craft Advisory', detail: 'Hazardous sea conditions. Conditions will be hazardous to small craft.',
      until: '2026-10-17T14:00:00-07:00', untilLabel: '14:00', source: 'NWS', relayedBy: w.officer, relayedAtLabel: '06:00',
    }]);
    expect(w.captainSnapshot('tug1').bulletins.length).toBe(1);
    expect(advisoryCard(w)).toBeUndefined();
    w.tick(250, NOW + 1000);
    expect(advisoryCard(w)).toBeUndefined();
    expect(w.conditionsView().advisories?.value[0]).toMatchObject({ relayedBy: w.officer, relayedAtLabel: '06:00', endsLabel: '14:00' });
    expect(w.dailyReport().lines).toContain(`NWS Small Craft Advisory in effect until 14:00, relayed to captains by ${w.officer} at 06:00.`);

    w.tick(250, ADVISORY_ENDS + 1000);
    expect(w.captainSnapshot('ferry1').bulletins).toEqual([]);
    expect(w.bulletins).toEqual([]);
    expect(w.audit.some((a) => a.action === 'Bulletin ended')).toBe(true);
    expect(w.dailyReport().lines.some((l) => l.includes('Small Craft Advisory'))).toBe(false);
  });

  it('removes the bulletin when NWS no longer lists the advisory', async () => {
    const w = liveWorld();
    w.setConditions(await conditionsAt(NOW));
    w.relayAdvisory('KLOX.SC.Y.0149');
    expect(w.bulletins.length).toBe(1);
    w.setConditions(await conditionsAt(NOW + 120_000, NO_ALERTS));
    expect(w.bulletins).toEqual([]);
  });

  it('does not bring a dismissed advisory back', async () => {
    const w = liveWorld();
    w.setConditions(await conditionsAt(NOW));
    w.cardAction(advisoryCard(w)!.id, 'dismiss');
    w.setConditions(await conditionsAt(NOW + 120_000));
    w.tick(250, NOW + 121_000);
    expect(advisoryCard(w)).toBeUndefined();
    expect(w.bulletins).toEqual([]);
  });

  it('keeps simulated scenes free of advisory cards but still lets the desk relay', async () => {
    const w = createWorld({ harbor, settings: defaultSettings });
    w.resetHarbor('night');
    w.tick(250, NOW);
    w.setConditions(await conditionsAt(NOW));
    expect(advisoryCard(w)).toBeUndefined();
    expect(w.commandSnapshot().conditions.advisories?.value.length).toBe(1);
    expect(w.headline().text).not.toContain('NWS');
    expect(w.dailyReport().lines.some((l) => l.includes('NWS'))).toBe(false);
    w.handle('relayAdvisory', { advisoryId: 'KLOX.SC.Y.0149' });
    expect(w.bulletins.length).toBe(1);
  });

  it('gives captains one conditions line with wind, waves and the next tide', async () => {
    const w = liveWorld();
    w.setConditions(await conditionsAt(NOW));
    const c = w.captainSnapshot('ferry1').conditions;
    expect(c.wind).toMatchObject({ speedMps: 2.6, gustMps: 3.2, fromDeg: 358, source: 'CO-OPS 9410647 Angels Gate wind' });
    expect(c.waves).toMatchObject({ heightM: 0.6, periodS: 14, source: 'NDBC 46222 San Pedro' });
    expect(c.nextTide).toMatchObject({ kind: 'high', label: '13:23', meters: 1.361 });
    const view = w.commandSnapshot().conditions;
    expect(view.sunrise?.value.label).toBe('06:59');
    expect(view.sunset?.value.label).toBe('18:17');
  });
});
