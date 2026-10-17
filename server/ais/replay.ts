import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECORDINGS_DIR = fileURLToPath(new URL('../../data/recordings', import.meta.url));

export interface RecordingLine {
  t: number;
  m: unknown;
}

export interface RecordingSummary {
  file: string;
  path: string;
  bytes: number;
  modifiedAt: number;
}

export interface LoadedRecording {
  file: string;
  lines: RecordingLine[];
  recordedFrom: number;
  recordedTo: number;
}

export function listRecordings(dir = RECORDINGS_DIR): RecordingSummary[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { file: name, path: full, bytes: stat.size, modifiedAt: stat.mtimeMs };
    })
    .filter((entry) => entry.bytes > 0)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function resolveRecording(nameOrPath: string | undefined, dir = RECORDINGS_DIR): string | null {
  if (nameOrPath) {
    const candidate = path.isAbsolute(nameOrPath) || nameOrPath.includes('/') ? path.resolve(nameOrPath) : path.join(dir, nameOrPath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return listRecordings(dir)[0]?.path ?? null;
}

export function parseRecording(text: string): RecordingLine[] {
  const lines: RecordingLine[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<RecordingLine>;
      if (typeof parsed.t === 'number' && parsed.m && typeof parsed.m === 'object') lines.push({ t: parsed.t, m: parsed.m });
    } catch {
      continue;
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

export function loadRecording(filePath: string): LoadedRecording {
  const lines = parseRecording(fs.readFileSync(filePath, 'utf8'));
  return {
    file: path.basename(filePath),
    lines,
    recordedFrom: lines[0]?.t ?? 0,
    recordedTo: lines[lines.length - 1]?.t ?? 0,
  };
}

export function replayOffsets(lines: RecordingLine[], maxGapMs: number): number[] {
  const offsets: number[] = [];
  let elapsed = 0;
  lines.forEach((line, i) => {
    if (i > 0) elapsed += Math.min(Math.max(0, line.t - lines[i - 1].t), maxGapMs);
    offsets.push(elapsed);
  });
  return offsets;
}

export interface ReplayOptions {
  lines: RecordingLine[];
  speed: number;
  maxGapMs: number;
  loopPauseMs: number;
  warmStartMs?: number;
  onMessage: (message: unknown, recordedAt: number, replayedAt: number) => void;
  onLoop?: (loop: number) => void;
  now?: () => number;
}

export interface Replay {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly loops: number;
}

export function createReplay(options: ReplayOptions): Replay {
  const now = options.now ?? Date.now;
  const speed = options.speed > 0 ? options.speed : 1;
  const offsets = replayOffsets(options.lines, options.maxGapMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let loops = 0;
  let index = 0;
  let loopStartedAt = 0;

  const warmStartMs = Math.max(0, options.warmStartMs ?? 0);
  const dueAt = (i: number) => loopStartedAt + Math.max(0, offsets[i] - warmStartMs) / speed;

  function tick(): void {
    timer = null;
    if (!running) return;
    const current = now();
    while (index < options.lines.length && dueAt(index) <= current) {
      const line = options.lines[index];
      options.onMessage(line.m, line.t, current);
      index++;
      if (!running) return;
    }
    if (index >= options.lines.length) {
      timer = setTimeout(beginLoop, options.loopPauseMs / speed);
      return;
    }
    timer = setTimeout(tick, Math.max(0, dueAt(index) - now()));
  }

  function beginLoop(): void {
    timer = null;
    if (!running) return;
    if (index > 0) {
      loops++;
      options.onLoop?.(loops);
    }
    index = 0;
    loopStartedAt = now();
    tick();
  }

  return {
    start() {
      if (running || options.lines.length === 0) return;
      running = true;
      index = 0;
      beginLoop();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get running() {
      return running;
    },
    get loops() {
      return loops;
    },
  };
}
