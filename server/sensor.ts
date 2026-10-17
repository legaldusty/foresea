import { createHash, timingSafeEqual } from 'node:crypto';
import type { SensorDetection } from '../src/shared/protocol';

export interface SensorLimits { maxBatch: number; maxIdLength: number; bbox: readonly number[] }

export type ParsedDetections = { ok: true; detections: SensorDetection[] } | { ok: false; error: string };

export interface AccessRequest {
  configuredKey: string | undefined;
  providedKey: unknown;
  remoteAddress: string | undefined;
  headers: Record<string, unknown>;
}

export type SensorAccess = { ok: true } | { ok: false; status: 401 | 403; error: string };

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const HEAT = ['hot', 'warm', 'cold'] as const;
const REPLY = ['none', 'correct', 'wrong'] as const;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'cf-connecting-ip', 'x-real-ip'];

class DetectionError extends Error {}

function fail(where: string, message: string): never {
  throw new DetectionError(`${where}: ${message}`);
}

function idField(raw: Record<string, unknown>, name: string, where: string, maxLength: number): string {
  const v = raw[name];
  const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!text) fail(where, `${name} is required, a string such as "NULL-SIM-1"`);
  if (text.length > maxLength) fail(where, `${name} is longer than ${maxLength} characters`);
  if (!ID_PATTERN.test(text)) fail(where, `${name} may use only letters, digits, dot, colon, dash and underscore`);
  return text;
}

function numberField(raw: Record<string, unknown>, name: string, where: string, min: number, max: number, required: boolean): number | undefined {
  const v = raw[name];
  if (v === undefined || v === null) {
    if (required) fail(where, `${name} is required, a number between ${min} and ${max}`);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(where, `${name} must be a number between ${min} and ${max}`);
  return v;
}

function choiceField<T extends string>(raw: Record<string, unknown>, name: string, where: string, options: readonly T[]): T | undefined {
  const v = raw[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) fail(where, `${name} must be one of ${options.join(', ')}`);
  return v as T;
}

function parseOne(raw: unknown, where: string, limits: SensorLimits): SensorDetection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(where, 'each detection must be a JSON object');
  const r = raw as Record<string, unknown>;
  const sensorId = idField(r, 'sensorId', where, limits.maxIdLength);
  const trackId = idField(r, 'trackId', where, limits.maxIdLength);
  if (typeof r.time !== 'string' || !Number.isFinite(Date.parse(r.time))) fail(where, 'time is required, an ISO 8601 string such as "2026-10-17T02:14:05Z"');
  const lat = numberField(r, 'lat', where, -90, 90, true) as number;
  const lon = numberField(r, 'lon', where, -180, 180, true) as number;
  const [west, south, east, north] = limits.bbox;
  if (lon < west || lon > east || lat < south || lat > north) fail(where, `lat ${lat}, lon ${lon} is outside the harbor chart (lat ${south} to ${north}, lon ${west} to ${east})`);
  const d: SensorDetection = { sensorId, trackId, time: new Date(Date.parse(r.time)).toISOString(), lat, lon };
  const depthM = numberField(r, 'depthM', where, 0, 11000, false);
  const speedMps = numberField(r, 'speedMps', where, 0, 100, false);
  const headingDeg = numberField(r, 'headingDeg', where, 0, 360, false);
  const sizeM = numberField(r, 'sizeM', where, 0.01, 500, false);
  const acousticDb = numberField(r, 'acousticDb', where, 0, 300, false);
  const confidence = numberField(r, 'confidence', where, 0, 1, false);
  const heat = choiceField(r, 'heat', where, HEAT);
  const pingReply = choiceField(r, 'pingReply', where, REPLY);
  if (depthM !== undefined) d.depthM = depthM;
  if (speedMps !== undefined) d.speedMps = speedMps;
  if (headingDeg !== undefined) d.headingDeg = headingDeg % 360;
  if (sizeM !== undefined) d.sizeM = sizeM;
  if (acousticDb !== undefined) d.acousticDb = acousticDb;
  if (confidence !== undefined) d.confidence = confidence;
  if (heat) d.heat = heat;
  if (pingReply) d.pingReply = pingReply;
  return d;
}

export function parseDetections(body: unknown, limits: SensorLimits): ParsedDetections {
  const list = Array.isArray(body) ? body : [body];
  if (!list.length) return { ok: false, error: 'Send one detection object or an array of them; the array is empty' };
  if (list.length > limits.maxBatch) return { ok: false, error: `Send at most ${limits.maxBatch} detections per request` };
  try {
    const detections = list.map((raw, i) => parseOne(raw, Array.isArray(body) ? `detection ${i}` : 'detection', limits));
    detections.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    return { ok: true, detections };
  } catch (err) {
    if (err instanceof DetectionError) return { ok: false, error: err.message };
    throw err;
  }
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

export function keysMatch(expected: string, given: string): boolean {
  return timingSafeEqual(digest(expected), digest(given)) && expected.length === given.length;
}

export function isLocalRequest(remoteAddress: string | undefined, headers: Record<string, unknown>): boolean {
  if (!remoteAddress || !LOOPBACK.has(remoteAddress)) return false;
  return PROXY_HEADERS.every((h) => headers[h] === undefined);
}

export function sensorAccess(r: AccessRequest): SensorAccess {
  const key = r.configuredKey?.trim();
  if (key) {
    const given = typeof r.providedKey === 'string' ? r.providedKey.trim() : '';
    return keysMatch(key, given) ? { ok: true } : { ok: false, status: 401, error: 'Missing or wrong x-giveway-key header' };
  }
  return isLocalRequest(r.remoteAddress, r.headers)
    ? { ok: true }
    : { ok: false, status: 403, error: 'GIVEWAY_SENSOR_KEY is not set on the hub, so only this computer may post detections. Set the key and send it in the x-giveway-key header.' };
}
