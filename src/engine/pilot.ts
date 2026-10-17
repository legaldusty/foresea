import type { LonLat } from './geo';

export type PilotRequest = 'launch' | 'steer' | 'surface' | 'night';

export const PILOT_REQUESTS: readonly PilotRequest[] = ['launch', 'steer', 'surface', 'night'];

export interface PilotState {
  mode: 'live' | 'sim';
  drivenId: string | null;
  bbox: readonly [number, number, number, number] | readonly number[];
}

export type PilotDecision =
  | { ok: true; action: 'spawn' }
  | { ok: true; action: 'scene' }
  | { ok: true; action: 'reuse'; contactId: string }
  | { ok: true; action: 'drive'; contactId: string; lonlat: LonLat }
  | { ok: true; action: 'remove'; contactId: string }
  | { ok: false; error: string };

export const PILOT_LIVE_REFUSAL = 'Ask the desk to switch to Simulation';

export function isPilotRequest(name: unknown): name is PilotRequest {
  return typeof name === 'string' && (PILOT_REQUESTS as readonly string[]).includes(name);
}

function lonLatIn(payload: unknown, bbox: PilotState['bbox']): LonLat | null {
  const raw = (payload as { lonlat?: unknown } | null)?.lonlat;
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [lon, lat] = raw;
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const [west, south, east, north] = bbox;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  return [lon, lat];
}

export function pilotDecision(request: unknown, payload: unknown, state: PilotState): PilotDecision {
  if (!isPilotRequest(request)) return { ok: false, error: 'The drive page can only start a night scene, launch, steer or surface the drone' };
  if (request === 'night') return state.mode === 'live' ? { ok: true, action: 'scene' } : { ok: false, error: 'The harbor is already in Simulation' };
  if (state.mode !== 'sim') return { ok: false, error: PILOT_LIVE_REFUSAL };
  if (request === 'launch') return state.drivenId ? { ok: true, action: 'reuse', contactId: state.drivenId } : { ok: true, action: 'spawn' };
  if (!state.drivenId) return { ok: false, error: 'Launch the drone first' };
  if (request === 'surface') return { ok: true, action: 'remove', contactId: state.drivenId };
  const lonlat = lonLatIn(payload, state.bbox);
  if (!lonlat) return { ok: false, error: 'Steer needs a point on the harbor chart' };
  return { ok: true, action: 'drive', contactId: state.drivenId, lonlat };
}
