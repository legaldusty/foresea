import type { ClockView } from '../../shared/protocol';

const DAY = 1440;

export function clockMinutes(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function simNow(clock: ClockView, at: number, now: number): number {
  const realMin = Math.max(0, now - at) / 60000;
  return clock.paused ? clock.simMin : clock.simMin + realMin * Math.max(1, clock.timeScale);
}

export function minutesUntil(label: string, clock: ClockView, at: number, now: number): number | null {
  const target = clockMinutes(label);
  if (target === null) return null;
  const current = ((simNow(clock, at, now) % DAY) + DAY) % DAY;
  const ahead = (((target - current) % DAY) + DAY) % DAY;
  return ahead > DAY / 2 ? ahead - DAY : ahead;
}

export function snapshotAt(receivedAt: number | null, serverWall: string): number {
  if (receivedAt !== null) return receivedAt;
  const wall = Date.parse(serverWall);
  return Number.isFinite(wall) ? wall : Date.now();
}
