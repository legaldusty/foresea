import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import settings from '../settings/giveway.settings.json';
import type { AisStatus, AisVessel } from '../src/shared/ais-types';
import { berthedAt, consequenceIdFor } from '../server/ais/berth';
import { createAisFeed, type SocketLike } from '../server/ais/live';
import { createVesselTable, parseAisMessage, parseEta, shiftUpdate } from '../server/ais/normalize';
import { onTimeBoard, resolvePort, type RouteMinutes } from '../server/ais/ontime';
import { createReplay, parseRecording, replayOffsets, type RecordingLine } from '../server/ais/replay';
import type { AisSettings } from '../server/ais/settings';

const RECEIVED_AT = Date.parse('2026-10-17T06:23:24.000Z');

function positionReport(mmsi = 563295800, overrides: Record<string, unknown> = {}) {
  return {
    MetaData: { MMSI: mmsi, ShipName: 'ONE READINESS       ', latitude: 33.75384, longitude: -118.26384, time_utc: '2026-10-17 06:23:24.407267655 +0000 UTC' },
    MessageType: 'PositionReport',
    Message: {
      PositionReport: {
        MessageID: 3, UserID: mmsi, Valid: true, NavigationalStatus: 5, RateOfTurn: 0, Sog: 0,
        Longitude: -118.26384, Latitude: 33.753838333333334, Cog: 124.1, TrueHeading: 42, Timestamp: 23,
        ...overrides,
      },
    },
  };
}

function classBReport(mmsi = 368444390, overrides: Record<string, unknown> = {}) {
  return {
    MetaData: { MMSI: mmsi, ShipName: 'PRAYER PRINCESS', latitude: 33.76197, longitude: -118.18486, time_utc: '2026-10-17 06:23:23.715035121 +0000 UTC' },
    MessageType: 'StandardClassBPositionReport',
    Message: {
      StandardClassBPositionReport: {
        MessageID: 18, UserID: mmsi, Valid: true, Cog: 360, Sog: 0, TrueHeading: 511,
        Latitude: 33.76197, Longitude: -118.18485666666668, Timestamp: 23,
        ...overrides,
      },
    },
  };
}

function staticData(mmsi = 215657000, overrides: Record<string, unknown> = {}) {
  return {
    MetaData: { MMSI: mmsi, ShipName: 'CMA CGM THALASSA    ', latitude: 33.73196, longitude: -118.25687, time_utc: '2026-10-17 06:23:51.140559891 +0000 UTC' },
    MessageType: 'ShipStaticData',
    Message: {
      ShipStaticData: {
        AisVersion: 2, CallSign: '9HA5230', Destination: 'USALX               ',
        Dimension: { A: 256, B: 92, C: 23, D: 22 }, Eta: { Day: 15, Hour: 1, Minute: 0, Month: 10 },
        ImoNumber: 9356294, MaximumStaticDraught: 13.5, MessageID: 5, Name: 'CMA CGM THALASSA    ',
        Type: 71, UserID: mmsi, Valid: true,
        ...overrides,
      },
    },
  };
}

function vessel(overrides: Partial<AisVessel>): AisVessel {
  return {
    mmsi: 1, name: 'TEST', lat: 33.744, lon: -118.2775, sogKn: 0, cogDeg: null, headingDeg: null,
    navStatus: { code: 0, label: 'under way using engine' }, shipType: 70, typeLabel: 'cargo',
    lengthM: 200, beamM: 32, destination: '', etaReported: null, aisClass: 'A', lastSeen: RECEIVED_AT, source: 'live',
    ...overrides,
  };
}

const cruise = settings.harbor.targets.find((target) => target.id === 'cruise')!;
const aisSettings = settings as unknown as AisSettings;

describe('normalize', () => {
  it('parses a class A position report', () => {
    const update = parseAisMessage(positionReport(), RECEIVED_AT)!;
    expect(update.kind).toBe('position');
    expect(update.mmsi).toBe(563295800);
    expect(update.name).toBe('ONE READINESS');
    expect(update.aisClass).toBe('A');
    expect(update.position).toEqual({ lat: 33.753838333333334, lon: -118.26384 });
    expect(update.sogKn).toBe(0);
    expect(update.cogDeg).toBe(124.1);
    expect(update.headingDeg).toBe(42);
    expect(update.navStatus).toBe(5);
  });

  it('turns unavailable heading, course and speed into null', () => {
    const update = parseAisMessage(positionReport(1, { TrueHeading: 511, Cog: 360, Sog: 102.3 }), RECEIVED_AT)!;
    expect(update.headingDeg).toBeNull();
    expect(update.cogDeg).toBeNull();
    expect(update.sogKn).toBeNull();
  });

  it('parses a class B position report without a nav status', () => {
    const update = parseAisMessage(classBReport(), RECEIVED_AT)!;
    expect(update.aisClass).toBe('B');
    expect(update.name).toBe('PRAYER PRINCESS');
    expect(update.cogDeg).toBeNull();
    expect(update.headingDeg).toBeNull();
    expect(update.navStatus).toBe(15);
  });

  it('parses ship static data with size, destination and ETA', () => {
    const update = parseAisMessage(staticData(), RECEIVED_AT)!;
    expect(update.kind).toBe('static');
    expect(update.name).toBe('CMA CGM THALASSA');
    expect(update.shipType).toBe(71);
    expect(update.lengthM).toBe(348);
    expect(update.beamM).toBe(45);
    expect(update.destination).toBe('USALX');
    expect(update.etaReported).toBe('2026-10-15T01:00:00.000Z');
  });

  it('ignores confirmations, errors and impossible positions', () => {
    expect(parseAisMessage({ Message: { CompressionEnabled: true }, MessageType: 'SubscriptionConfirmation' }, RECEIVED_AT)).toBeNull();
    expect(parseAisMessage({ error: 'Api Key Is Not Valid' }, RECEIVED_AT)).toBeNull();
    expect(parseAisMessage(positionReport(1, { Latitude: 91, Longitude: 181 }), RECEIVED_AT)).toBeNull();
    expect(parseAisMessage(positionReport(1, { Valid: false }), RECEIVED_AT)).toBeNull();
  });

  it('merges static and position data by MMSI', () => {
    const table = createVesselTable(settings);
    table.ingest(staticData(42), RECEIVED_AT, 'live');
    table.ingest(positionReport(42, { Sog: 11.2, NavigationalStatus: 0 }), RECEIVED_AT + 1000, 'live');
    const merged = table.get(42, RECEIVED_AT + 2000)!;
    expect(merged.name).toBe('ONE READINESS');
    expect(merged.typeLabel).toBe('cargo');
    expect(merged.lengthM).toBe(348);
    expect(merged.destination).toBe('USALX');
    expect(merged.sogKn).toBe(11.2);
    expect(merged.navStatus).toEqual({ code: 0, label: 'under way using engine' });
    expect(merged.lastSeen).toBe(RECEIVED_AT + 1000);
    expect(merged.source).toBe('live');
  });

  it('uses the static message position only until a real report arrives', () => {
    const table = createVesselTable(settings);
    table.ingest(staticData(7), RECEIVED_AT, 'live');
    expect(table.get(7, RECEIVED_AT)!.lat).toBeCloseTo(33.73196);
    table.ingest(positionReport(7), RECEIVED_AT + 500, 'live');
    table.ingest(staticData(7), RECEIVED_AT + 900, 'live');
    expect(table.get(7, RECEIVED_AT + 900)!.lat).toBeCloseTo(33.75384);
  });

  it('drops vessels older than staleMinutes', () => {
    const table = createVesselTable(settings);
    table.ingest(positionReport(1), RECEIVED_AT, 'live');
    table.ingest(classBReport(2), RECEIVED_AT + 10 * 60_000, 'live');
    const later = RECEIVED_AT + (settings.ais.staleMinutes + 1) * 60_000;
    expect(table.vessels(later).map((v) => v.mmsi)).toEqual([2]);
    expect(table.prune(later)).toBe(1);
    expect(table.size).toBe(1);
  });

  it('shifts replayed timestamps and ETAs together', () => {
    const update = parseAisMessage(staticData(), RECEIVED_AT)!;
    const shifted = shiftUpdate(update, 3_600_000);
    expect(shifted.at).toBe(RECEIVED_AT + 3_600_000);
    expect(shifted.etaReported).toBe('2026-10-15T02:00:00.000Z');
  });
});

describe('ETA parsing', () => {
  const ref = Date.parse('2026-10-17T06:00:00Z');

  it('treats month 0, day 0, hour 24 and minute 60 as unavailable', () => {
    expect(parseEta({ Month: 0, Day: 0, Hour: 24, Minute: 60 }, ref)).toBeNull();
    expect(parseEta({ Month: 0, Day: 15, Hour: 1, Minute: 0 }, ref)).toBeNull();
    expect(parseEta({ Month: 10, Day: 0, Hour: 1, Minute: 0 }, ref)).toBeNull();
    expect(parseEta({ Month: 10, Day: 15, Hour: 24, Minute: 0 }, ref)).toBeNull();
    expect(parseEta({ Month: 10, Day: 15, Hour: 1, Minute: 60 }, ref)).toBeNull();
    expect(parseEta(undefined, ref)).toBeNull();
  });

  it('rejects dates that do not exist', () => {
    expect(parseEta({ Month: 2, Day: 30, Hour: 1, Minute: 0 }, ref)).toBeNull();
    expect(parseEta({ Month: 13, Day: 1, Hour: 1, Minute: 0 }, ref)).toBeNull();
  });

  it('picks the year closest to the message time', () => {
    expect(parseEta({ Month: 9, Day: 7, Hour: 17, Minute: 0 }, ref)).toBe('2026-09-07T17:00:00.000Z');
    expect(parseEta({ Month: 1, Day: 2, Hour: 8, Minute: 30 }, Date.parse('2026-12-30T12:00:00Z'))).toBe('2027-01-02T08:30:00.000Z');
    expect(parseEta({ Month: 12, Day: 30, Hour: 23, Minute: 0 }, Date.parse('2027-01-02T00:00:00Z'))).toBe('2026-12-30T23:00:00.000Z');
  });
});

describe('destination resolution', () => {
  it.each([
    ['USLAX', 'LA'], ['US LAX', 'LA'], ['  us   lax  ', 'LA'], ['LOS ANGELES', 'LA'], ['LA', 'LA'], ['L.A.', 'LA'],
    ['PORT OF LA', 'LA'], ['CNNGB > USLAX', 'LA'], ['TWTPE>USLAX', 'LA'], ['USALX', 'LA'], ['LA 187', 'LA'], ['SAN PEDRO', 'LA'],
    ['USLGB', 'LB'], ['US LGB', 'LB'], ['LONG BEACH', 'LB'], ['LGB', 'LB'], ['TWKHH>USLGB', 'LB'], ['CA TLB>US LGB', 'LB'],
    ['LB ANCH', 'LB'], ['PORT OF LONG BEACH', 'LB'],
  ])('resolves %s to %s', (destination, port) => {
    expect(resolvePort(destination)).toBe(port);
  });

  it.each(['', 'USHNL', 'CREW 12', 'US VA3', 'LAS PALMAS', 'LA SPEZIA', 'USLAX>USOAK', 'LA/LB'])('leaves %s unresolved', (destination) => {
    expect(resolvePort(destination)).toBeNull();
  });
});

describe('berth detection', () => {
  it('finds a stopped passenger ship at the cruise berth', () => {
    const ship = vessel({ mmsi: 9, shipType: 60, typeLabel: 'passenger', lengthM: 120, lat: cruise.lat + 0.001, lon: cruise.lon });
    expect(berthedAt([ship], cruise, settings)?.mmsi).toBe(9);
    expect(consequenceIdFor([ship], cruise, settings)).toBe('cruise');
  });

  it('accepts a long ship that reports moored without a speed', () => {
    const ship = vessel({ sogKn: null, navStatus: { code: 5, label: 'moored' }, lengthM: 300 });
    expect(berthedAt([ship], cruise, settings)).not.toBeNull();
  });

  it('ignores moving, small or distant vessels', () => {
    const moving = vessel({ shipType: 60, sogKn: 6 });
    const tug = vessel({ shipType: 52, typeLabel: 'tug', lengthM: 30 });
    const distant = vessel({ shipType: 60, lat: cruise.lat + 0.0055 });
    expect(berthedAt([moving, tug, distant], cruise, settings)).toBeNull();
    expect(consequenceIdFor([moving, tug, distant], cruise, settings)).toBe('cruiseEmpty');
  });

  it('reads vessels from a table', () => {
    const table = createVesselTable(settings);
    table.ingest(staticData(5, { Type: 69, Dimension: { A: 200, B: 94, C: 16, D: 16 } }), RECEIVED_AT, 'live');
    table.ingest(positionReport(5, { Latitude: cruise.lat, Longitude: cruise.lon, Sog: 0.2, NavigationalStatus: 0 }), RECEIVED_AT, 'live');
    expect(berthedAt(table, cruise, settings, RECEIVED_AT)?.mmsi).toBe(5);
  });
});

describe('on-time board', () => {
  const now = Date.parse('2026-10-17T07:00:00Z');
  const minutesFromNow = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const calls: [number, number][][] = [];
  const thirtyMinutes: RouteMinutes = (from, to) => {
    calls.push([from, to]);
    return 30;
  };
  const board = (vessels: AisVessel[], routeMinutes: RouteMinutes = thirtyMinutes) =>
    onTimeBoard(vessels, { routeMinutes, now, settings: aisSettings });
  const angelsGate = settings.harbor.gates.find((gate) => gate.name === 'Angels Gate')!;
  const queensGate = settings.harbor.gates.find((gate) => gate.name === 'Queens Gate')!;
  const underway = { sogKn: 12, navStatus: { code: 0, label: 'under way using engine' } };

  beforeEach(() => {
    calls.length = 0;
  });

  it('marks an arrival on time and routes LA ships to Angels Gate from outside', () => {
    const [row] = board([vessel({ ...underway, lat: 33.69, lon: -118.25, destination: 'USLAX', etaReported: minutesFromNow(40) })]);
    expect(row.status).toBe('on time');
    expect(row.port).toBe('LA');
    expect(row.deltaMin).toBe(-10);
    expect(row.ourEta).toBe(minutesFromNow(30));
    expect(calls[0][1]).toEqual([angelsGate.lon, angelsGate.lat]);
  });

  it('marks an arrival at risk when it runs later than onTimeLateMinutes', () => {
    const [row] = board([vessel({ ...underway, lat: 33.69, lon: -118.19, destination: 'US LGB', etaReported: minutesFromNow(10) })]);
    expect(row.status).toBe('at risk');
    expect(row.deltaMin).toBe(20);
    expect(calls[0][1]).toEqual([queensGate.lon, queensGate.lat]);
  });

  it('routes inside the breakwater to the nearest target berth', () => {
    board([vessel({ ...underway, lat: 33.735, lon: -118.27, destination: 'LOS ANGELES', etaReported: minutesFromNow(30) })]);
    const research = settings.harbor.targets.find((target) => target.id === 'research')!;
    expect(calls[0][1]).toEqual([research.lon, research.lat]);
  });

  it('reports berthed, anchored and unknown states with reasons', () => {
    const rows = board([
      vessel({ mmsi: 1, destination: 'USLAX', lat: 33.75, lon: -118.26, navStatus: { code: 5, label: 'moored' } }),
      vessel({ mmsi: 2, destination: 'USLGB', lat: 33.70, lon: -118.16, sogKn: 0.1 }),
      vessel({ mmsi: 3, ...underway, destination: 'USLGB', lat: 33.70, lon: -118.16 }),
      vessel({ mmsi: 4, ...underway, destination: 'USLGB', lat: 33.70, lon: -118.16, etaReported: minutesFromNow(-24 * 60) }),
      vessel({ mmsi: 5, ...underway, destination: 'USHNL', lat: 33.70, lon: -118.16, etaReported: minutesFromNow(30) }),
    ]);
    const byMmsi = new Map(rows.map((row) => [row.mmsi, row]));
    expect(rows).toHaveLength(4);
    expect(byMmsi.get(1)!.status).toBe('berthed');
    expect(byMmsi.get(2)!.status).toBe('anchored');
    expect(byMmsi.get(3)!.status).toBe('unknown');
    expect(byMmsi.get(3)!.why).toBe('No reported ETA in AIS.');
    expect(byMmsi.get(4)!.status).toBe('unknown');
    expect(byMmsi.get(4)!.why).toContain('stale');
  });

  it('says unknown when no route exists', () => {
    const [row] = board([vessel({ ...underway, lat: 33.69, lon: -118.25, destination: 'USLAX', etaReported: minutesFromNow(30) })], () => null);
    expect(row.status).toBe('unknown');
    expect(row.why).toBe('No water route to Angels Gate.');
  });

  it('puts at-risk rows first', () => {
    const rows = board([
      vessel({ mmsi: 1, ...underway, lat: 33.69, lon: -118.25, destination: 'USLAX', etaReported: minutesFromNow(60) }),
      vessel({ mmsi: 2, ...underway, lat: 33.69, lon: -118.25, destination: 'USLAX', etaReported: minutesFromNow(5) }),
    ]);
    expect(rows.map((row) => row.status)).toEqual(['at risk', 'on time']);
  });
});

describe('replay', () => {
  const base = Date.parse('2026-10-17T06:23:16.000Z');
  const lines: RecordingLine[] = [
    { t: base, m: positionReport(1) },
    { t: base + 1000, m: classBReport(2) },
    { t: base + 3000, m: staticData(3) },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-18T19:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses JSONL and skips broken or partial lines', () => {
    const text = `${JSON.stringify({ t: 2, m: { a: 1 } })}\nnot json\n${JSON.stringify({ t: 1, m: { b: 2 } })}\n{"t":3,"m":`;
    expect(parseRecording(text).map((line) => line.t)).toEqual([1, 2]);
  });

  it('caps long gaps', () => {
    expect(replayOffsets([{ t: 0, m: {} }, { t: 5000, m: {} }, { t: 200_000, m: {} }], 30_000)).toEqual([0, 5000, 35_000]);
  });

  it('keeps original timing scaled by speed, then loops', () => {
    const seen: { recordedAt: number; replayedAt: number }[] = [];
    let loops = 0;
    const replay = createReplay({
      lines, speed: 2, maxGapMs: 30_000, loopPauseMs: 2000,
      onMessage: (_m, recordedAt, replayedAt) => seen.push({ recordedAt, replayedAt }),
      onLoop: (loop) => { loops = loop; },
    });
    const start = Date.now();
    replay.start();
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(3);
    expect(seen.map((entry) => entry.replayedAt - start)).toEqual([0, 500, 1500]);
    expect(seen.map((entry) => entry.recordedAt)).toEqual(lines.map((line) => line.t));
    vi.advanceTimersByTime(1000);
    expect(loops).toBe(1);
    expect(seen).toHaveLength(4);
    replay.stop();
    vi.advanceTimersByTime(10_000);
    expect(seen).toHaveLength(4);
  });

  it('plays the warm start window at once', () => {
    const seen: number[] = [];
    const replay = createReplay({ lines, speed: 1, maxGapMs: 30_000, loopPauseMs: 60_000, warmStartMs: 1000, onMessage: (_m, t) => seen.push(t) });
    replay.start();
    expect(seen).toEqual([base, base + 1000]);
    vi.advanceTimersByTime(2000);
    expect(seen).toHaveLength(3);
    replay.stop();
  });

  it('shows a recording as current, tagged replay, with the real recording time in the status', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giveway-ais-'));
    fs.writeFileSync(path.join(dir, 'test.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n'));
    const statuses: AisStatus[] = [];
    const batches: AisVessel[][] = [];
    const feed = createAisFeed({
      settings: aisSettings, mode: 'replay', recording: 'test.jsonl', recordingsDir: dir,
      onVessels: (vessels) => batches.push(vessels), onStatus: (status) => statuses.push(status),
    });
    vi.advanceTimersByTime(5000);
    const status = feed.status();
    expect(status.mode).toBe('replay');
    expect(status.recording?.recordedFrom).toBe(base);
    expect(status.recording?.file).toBe('test.jsonl');
    expect(status.detail).toContain('not live');
    const vessels = feed.vessels();
    expect(vessels.length).toBe(3);
    expect(vessels.every((v) => v.source === 'replay')).toBe(true);
    expect(vessels.every((v) => Date.now() - v.lastSeen < 10_000)).toBe(true);
    feed.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

class FakeSocket extends EventEmitter implements SocketLike {
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit('close');
  }
}

describe('live feed', () => {
  let dir: string;
  let sockets: FakeSocket[];
  const base = Date.parse('2026-10-17T06:23:16.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giveway-ais-'));
    fs.writeFileSync(path.join(dir, 'fallback.jsonl'), JSON.stringify({ t: base, m: positionReport(1) }));
    sockets = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const start = (mode: 'auto' | 'live', onVessels: (v: AisVessel[]) => void = () => {}) =>
    createAisFeed({
      settings: aisSettings, mode, recording: 'fallback.jsonl', recordingsDir: dir, apiKey: 'test-key',
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onVessels, onStatus: () => {},
    });

  it('subscribes with the key, bounding box and message types as soon as the socket opens', () => {
    const feed = start('live');
    sockets[0].emit('open');
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      APIKey: 'test-key',
      BoundingBoxes: [settings.ais.bbox],
      FilterMessageTypes: settings.ais.messageTypes,
    });
    feed.stop();
  });

  it('goes live on the first vessel message and throttles updates to two per second', () => {
    const emits: number[] = [];
    const feed = start('auto', () => emits.push(Date.now()));
    sockets[0].emit('open');
    for (let i = 0; i < 20; i++) {
      sockets[0].emit('message', Buffer.from(JSON.stringify(positionReport(100 + i))));
      vi.advanceTimersByTime(100);
    }
    expect(feed.status().mode).toBe('live');
    expect(feed.vessels().every((v) => v.source === 'live')).toBe(true);
    for (let i = 1; i < emits.length; i++) expect(emits[i] - emits[i - 1]).toBeGreaterThanOrEqual(500);
    expect(emits.length).toBeLessThanOrEqual(5);
    feed.stop();
  });

  it('falls back to replay when aisstream sends an error', () => {
    const feed = start('auto');
    sockets[0].emit('open');
    sockets[0].emit('message', Buffer.from(JSON.stringify({ error: 'Api Key Is Not Valid' })));
    expect(feed.status().mode).toBe('replay');
    expect(feed.status().detail).toContain('Api Key Is Not Valid');
    expect(feed.status().detail).not.toContain('test-key');
    feed.stop();
  });

  it('falls back to replay when no vessel arrives in time, then returns to live', () => {
    const feed = start('auto');
    sockets[0].emit('open');
    vi.advanceTimersByTime(settings.ais.liveFirstVesselSeconds * 1000 + 10);
    expect(feed.status().mode).toBe('replay');
    expect(feed.status().detail).toContain(`within ${settings.ais.liveFirstVesselSeconds} s`);
    sockets[0].emit('message', Buffer.from(JSON.stringify(positionReport(77))));
    expect(feed.status().mode).toBe('live');
    expect(feed.vessels().map((v) => v.mmsi)).toEqual([77]);
    feed.stop();
  });

  it('falls back to replay at once when the network is down', () => {
    const feed = start('auto');
    sockets[0].emit('error', new Error('getaddrinfo ENOTFOUND stream.aisstream.io'));
    sockets[0].emit('close');
    expect(feed.status().mode).toBe('replay');
    expect(feed.status().detail).toContain('ENOTFOUND');
    vi.advanceTimersByTime(settings.ais.reconnectBaseSeconds * 1000 + 10);
    expect(sockets).toHaveLength(2);
    feed.stop();
  });

  it('stays offline and reconnects with backoff in live mode', () => {
    const feed = start('live');
    sockets[0].emit('error', new Error('connect ECONNREFUSED'));
    sockets[0].emit('close');
    expect(feed.status().mode).toBe('offline');
    expect(feed.status().detail).toContain('Retrying');
    vi.advanceTimersByTime(settings.ais.reconnectBaseSeconds * 1000);
    expect(sockets).toHaveLength(2);
    sockets[1].emit('close');
    vi.advanceTimersByTime(settings.ais.reconnectBaseSeconds * 1000);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(settings.ais.reconnectBaseSeconds * 1000);
    expect(sockets).toHaveLength(3);
    feed.stop();
  });
});
