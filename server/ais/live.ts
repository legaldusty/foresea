import WebSocket from 'ws';
import { config as loadDotenv } from 'dotenv';
import type { AisRecordingInfo, AisStatus, AisVessel } from '../../src/shared/ais-types';
import { createVesselTable, parseAisMessage, shiftUpdate, type VesselTable } from './normalize';
import { createReplay, loadRecording, resolveRecording, RECORDINGS_DIR, type LoadedRecording, type Replay } from './replay';
import type { AisSettings } from './settings';

export const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const PRUNE_EVERY_MS = 15_000;

export type FeedMode = 'auto' | 'live' | 'replay';

export interface SocketLike {
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string, connectTimeoutMs: number) => SocketLike;

export interface AisFeedOptions {
  settings: AisSettings;
  mode: FeedMode;
  recording?: string;
  onVessels: (vessels: AisVessel[]) => void;
  onStatus: (status: AisStatus) => void;
  apiKey?: string;
  socketFactory?: SocketFactory;
  recordingsDir?: string;
  now?: () => number;
}

export interface AisFeed {
  stop(): void;
  status(): AisStatus;
  vessels(): AisVessel[];
  readonly table: VesselTable;
}

const defaultSocketFactory: SocketFactory = (url, connectTimeoutMs) =>
  new WebSocket(url, { handshakeTimeout: connectTimeoutMs }) as unknown as SocketLike;

let dotenvLoaded = false;

function apiKeyFromEnv(): string | undefined {
  if (!dotenvLoaded) {
    loadDotenv();
    dotenvLoaded = true;
  }
  const key = process.env.AISSTREAM_API_KEY?.trim();
  return key ? key : undefined;
}

function textOf(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

export function formatClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function createAisFeed(options: AisFeedOptions): AisFeed {
  const { settings, mode, onVessels, onStatus } = options;
  const ais = settings.ais;
  const now = options.now ?? Date.now;
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const apiKey = mode === 'replay' ? undefined : options.apiKey ?? apiKeyFromEnv();
  const table = createVesselTable(settings);
  const minEmitGapMs = 1000 / Math.max(0.001, ais.emitMaxPerSecond);
  const liveWaitMs = ais.liveFirstVesselSeconds * 1000;

  let stopped = false;
  let socket: SocketLike | null = null;
  let liveFlowing = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let liveDeadline: ReturnType<typeof setTimeout> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitAt = -Infinity;
  let replay: Replay | null = null;
  let replayInfo: AisRecordingInfo | null = null;
  let lastProblem = 'Lost the aisstream.io connection.';
  let current: AisStatus = { mode: 'offline', detail: 'Starting the AIS feed.', since: now() };

  function setStatus(next: Omit<AisStatus, 'since'>): void {
    const changed = next.mode !== current.mode || next.detail !== current.detail;
    current = { ...next, since: changed ? now() : current.since };
    if (changed) onStatus(current);
  }

  function emitNow(): void {
    emitTimer = null;
    lastEmitAt = now();
    onVessels(table.vessels(now()));
  }

  function scheduleEmit(): void {
    if (emitTimer || stopped) return;
    emitTimer = setTimeout(emitNow, Math.max(0, lastEmitAt + minEmitGapMs - now()));
  }

  const pruneTimer = setInterval(() => {
    if (table.prune(now()) > 0) scheduleEmit();
  }, PRUNE_EVERY_MS);
  pruneTimer.unref?.();

  function clearLiveDeadline(): void {
    if (liveDeadline) clearTimeout(liveDeadline);
    liveDeadline = null;
  }

  function armLiveDeadline(): void {
    if (mode !== 'auto' || liveDeadline || replay) return;
    liveDeadline = setTimeout(() => {
      liveDeadline = null;
      if (!liveFlowing && !stopped) startReplay(`aisstream.io sent no vessel message within ${ais.liveFirstVesselSeconds} s.`);
    }, liveWaitMs);
  }

  function replayDetail(info: AisRecordingInfo, reason: string): string {
    const zone = ais.displayTimeZone;
    const span = `${formatClock(info.recordedFrom, zone)} to ${formatClock(info.recordedTo, zone)}`;
    const speed = info.speed === 1 ? 'real time' : `${info.speed}x speed`;
    return `${reason} Showing a replay of ${info.file}, recorded ${span}, at ${speed}. These ships are not live.`.trim();
  }

  function startReplay(reason: string): void {
    if (stopped) return;
    clearLiveDeadline();
    if (replay && replayInfo) {
      setStatus({ mode: 'replay', detail: replayDetail(replayInfo, reason), recording: replayInfo });
      return;
    }
    const filePath = resolveRecording(options.recording ?? ais.recording, options.recordingsDir ?? RECORDINGS_DIR);
    let loaded: LoadedRecording | null = null;
    if (filePath) {
      try {
        loaded = loadRecording(filePath);
      } catch {
        loaded = null;
      }
    }
    if (!loaded || loaded.lines.length === 0) {
      setStatus({ mode: 'offline', detail: `${reason} No AIS recording was found in data/recordings, so no ships are shown.`.trim() });
      return;
    }
    const speed = ais.replaySpeed > 0 ? ais.replaySpeed : 1;
    const info: AisRecordingInfo = {
      file: loaded.file,
      recordedFrom: loaded.recordedFrom,
      recordedTo: loaded.recordedTo,
      messages: loaded.lines.length,
      speed,
    };
    if (liveFlowing || table.size > 0) table.clear();
    liveFlowing = false;
    replayInfo = info;
    replay = createReplay({
      lines: loaded.lines,
      speed,
      maxGapMs: ais.replayMaxGapSeconds * 1000,
      loopPauseMs: ais.replayLoopPauseSeconds * 1000,
      warmStartMs: ais.replayWarmStartMinutes * 60_000,
      now,
      onMessage: (message, recordedAt, replayedAt) => {
        const update = parseAisMessage(message, recordedAt);
        if (!update) return;
        if (table.apply(shiftUpdate(update, replayedAt - recordedAt), 'replay')) scheduleEmit();
      },
    });
    setStatus({ mode: 'replay', detail: replayDetail(info, reason), recording: info });
    replay.start();
    scheduleEmit();
  }

  function stopReplay(): void {
    replay?.stop();
    replay = null;
    replayInfo = null;
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer || mode === 'replay') return;
    const delayMs = Math.min(ais.reconnectMaxSeconds * 1000, ais.reconnectBaseSeconds * 1000 * 2 ** Math.max(0, attempts - 1));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
    if (!replay) setStatus({ mode: 'offline', detail: `${lastProblem} Retrying in ${Math.round(delayMs / 1000)} s.` });
  }

  function liveProblem(reason: string, fallBackNow: boolean): void {
    if (stopped) return;
    lastProblem = reason;
    if (mode === 'auto' && (fallBackNow || !liveFlowing)) {
      if (fallBackNow) startReplay(reason);
      else armLiveDeadline();
      return;
    }
    if (mode === 'live') setStatus({ mode: 'offline', detail: reason });
  }

  function handleMessage(data: unknown): void {
    let parsed: { error?: unknown };
    try {
      parsed = JSON.parse(textOf(data));
    } catch {
      return;
    }
    if (parsed && typeof parsed.error === 'string') {
      liveFlowing = false;
      liveProblem(`aisstream.io refused the subscription: ${parsed.error}.`, true);
      socket?.close();
      return;
    }
    const update = parseAisMessage(parsed, now());
    if (!update) return;
    if (replay) {
      stopReplay();
      table.clear();
    }
    clearLiveDeadline();
    attempts = 0;
    if (!liveFlowing) {
      liveFlowing = true;
      setStatus({ mode: 'live', detail: 'Live AIS from aisstream.io.' });
    }
    if (table.apply(update, 'live')) scheduleEmit();
  }

  function connect(): void {
    if (stopped || !apiKey) return;
    attempts++;
    let opened = false;
    let ws: SocketLike;
    try {
      ws = socketFactory(AISSTREAM_URL, ais.connectTimeoutSeconds * 1000);
    } catch (error) {
      liveProblem(`Could not reach aisstream.io (${(error as Error).message}).`, true);
      scheduleReconnect();
      return;
    }
    socket = ws;
    if (!replay && !liveFlowing) setStatus({ mode: 'offline', detail: 'Connecting to aisstream.io.' });
    armLiveDeadline();
    ws.on('open', () => {
      opened = true;
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [ais.bbox],
        FilterMessageTypes: ais.messageTypes,
      }));
    });
    ws.on('message', handleMessage);
    ws.on('error', (error: Error) => {
      if (!opened) liveProblem(`Could not reach aisstream.io (${error.message}).`, true);
    });
    ws.on('close', () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      const hadLive = liveFlowing;
      liveFlowing = false;
      if (hadLive) liveProblem('The aisstream.io connection closed.', false);
      scheduleReconnect();
    });
  }

  if (mode === 'replay') {
    startReplay('Replay mode was chosen.');
  } else if (!apiKey) {
    if (mode === 'auto') startReplay('AISSTREAM_API_KEY is not set in .env.');
    else setStatus({ mode: 'offline', detail: 'AISSTREAM_API_KEY is not set in .env, so live AIS is off.' });
  } else {
    connect();
  }

  return {
    stop() {
      stopped = true;
      clearLiveDeadline();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (emitTimer) clearTimeout(emitTimer);
      clearInterval(pruneTimer);
      stopReplay();
      socket?.close();
      socket = null;
    },
    status: () => current,
    vessels: () => table.vessels(now()),
    table,
  };
}
