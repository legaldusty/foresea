import { pathLength } from './grid';
import type { GridLike } from './zones';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];

export const PRIORITY_MEANING: Record<Priority, { words: string; when: string; delivery: string }> = {
  P1: { words: 'Act now', when: 'In the zone, or entering within 5 min', delivery: 'Buzz, sound, full-screen map' },
  P2: { words: 'Act soon', when: 'Your route reaches it within 15 min', delivery: 'Notification and banner' },
  P3: { words: 'Heads up', when: 'Your route crosses it later', delivery: 'Silent map update' },
  P4: { words: 'Info', when: 'Not on your route', delivery: 'Map only' },
};

export function minutesUntilZone(grid: GridLike, route: number[], mask: Uint8Array | null, speedMps: number): number | null {
  if (!mask || !route.length) return null;
  if (mask[route[0]]) return 0;
  for (let k = 1; k < route.length; k++) {
    if (mask[route[k]]) {
      const cells = pathLength(grid as never, route.slice(0, k + 1));
      return speedMps > 0 ? (cells * grid.cellMeters) / speedMps / 60 : null;
    }
  }
  return null;
}

export function basePriority(minutes: number | null, p1Minutes: number, p2Minutes: number): Priority {
  if (minutes === null) return 'P4';
  if (minutes <= p1Minutes) return 'P1';
  if (minutes <= p2Minutes) return 'P2';
  return 'P3';
}

export const moreUrgent = (a: Priority, b: Priority): Priority => (PRIORITIES.indexOf(a) <= PRIORITIES.indexOf(b) ? a : b);
export const lessUrgent = (a: Priority, b: Priority): Priority => (PRIORITIES.indexOf(a) >= PRIORITIES.indexOf(b) ? a : b);

export interface PriorityRules {
  p1Minutes: number;
  p2Minutes: number;
  floor?: Priority | null;
  ceiling?: Priority | null;
  nearby?: boolean;
}

export function priorityFor(minutes: number | null, rules: PriorityRules): Priority {
  let p = basePriority(minutes, rules.p1Minutes, rules.p2Minutes);
  if (rules.floor && rules.nearby) p = moreUrgent(p, rules.floor);
  if (rules.ceiling) p = lessUrgent(p, rules.ceiling);
  return p;
}
