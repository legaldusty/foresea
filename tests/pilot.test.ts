import { describe, expect, it } from 'vitest';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld } from '../src/engine/world';
import { pilotDecision, PILOT_LIVE_REFUSAL, type PilotState } from '../src/engine/pilot';

const bbox = defaultSettings.map.bbox;
const sim = (drivenId: string | null): PilotState => ({ mode: 'sim', drivenId, bbox });
const inHarbor = { lonlat: [-118.23, 33.73] };

describe('pilot permissions', () => {
  it('allows nothing in Live mode', () => {
    for (const request of ['launch', 'steer', 'surface']) {
      expect(pilotDecision(request, inHarbor, { mode: 'live', drivenId: 'C-14', bbox })).toEqual({ ok: false, error: PILOT_LIVE_REFUSAL });
    }
  });

  it('starts a night scene from Live mode only', () => {
    expect(pilotDecision('night', {}, { mode: 'live', drivenId: null, bbox })).toEqual({ ok: true, action: 'scene' });
    expect(pilotDecision('night', {}, sim(null)).ok).toBe(false);
  });

  it('launches the driven preset only when none exists, otherwise reuses it', () => {
    expect(pilotDecision('launch', {}, sim(null))).toEqual({ ok: true, action: 'spawn' });
    expect(pilotDecision('launch', {}, sim('C-14'))).toEqual({ ok: true, action: 'reuse', contactId: 'C-14' });
  });

  it('steers only the driven contact, only to a point on the chart', () => {
    expect(pilotDecision('steer', inHarbor, sim('C-14'))).toEqual({ ok: true, action: 'drive', contactId: 'C-14', lonlat: [-118.23, 33.73] });
    expect(pilotDecision('steer', { contactId: 'C-99', ...inHarbor }, sim('C-14'))).toMatchObject({ action: 'drive', contactId: 'C-14' });
    expect(pilotDecision('steer', inHarbor, sim(null)).ok).toBe(false);
    for (const bad of [{ lonlat: [0, 0] }, { lonlat: ['x', 33.7] }, { lonlat: [-118.23] }, null, 'go']) {
      expect(pilotDecision('steer', bad, sim('C-14')).ok).toBe(false);
    }
  });

  it('surfaces only the driven contact', () => {
    expect(pilotDecision('surface', { contactId: 'C-3' }, sim('C-14'))).toEqual({ ok: true, action: 'remove', contactId: 'C-14' });
    expect(pilotDecision('surface', {}, sim(null)).ok).toBe(false);
  });

  it('refuses every desk event', () => {
    for (const request of ['spawn', 'drive', 'removeContact', 'publish', 'reset', 'clock', 'contactParams', undefined]) {
      expect(pilotDecision(request, {}, sim('C-14')).ok).toBe(false);
    }
  });
});

describe('pilot snapshot', () => {
  it('shows the drone and the targets, never risk or predictions', () => {
    const harbor = buildHarbor(gridJson as never, defaultSettings);
    const w = createWorld({ harbor, settings: defaultSettings });
    w.resetHarbor('night');
    expect(w.pilotSnapshot().drone).toBeNull();
    const c = w.spawn({ preset: 'driven' })!;
    const fuel = harbor.targets.find((t) => t.id === 'fuel')!;
    w.drive(c.id, [fuel.lon, fuel.lat]);
    for (let i = 0; i < 400; i++) w.tick(250, 1_800_000_000_000 + i * 250);
    const snap = w.pilotSnapshot();
    expect(snap.mode).toBe('sim');
    expect(snap.drone?.id).toBe(c.id);
    expect(snap.drone?.steerTo).not.toBeNull();
    expect(snap.targets.map((t) => t.id)).toEqual(harbor.targets.map((t) => t.id));
    expect(Object.keys(snap).sort()).toEqual(['clock', 'drone', 'launch', 'mode', 'serverWall', 'targets']);
    expect(Object.keys(snap.drone!).sort()).toEqual(['headingDeg', 'id', 'label', 'lonlat', 'speedKn', 'steerTo', 'track']);
    expect(JSON.stringify(snap)).not.toMatch(/risk|odds|score|forecast|hostil|zone/i);
  });
});
