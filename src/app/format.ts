import { compassPoint } from '../engine/geo';

export const pct = (p: number): string => `${Math.round(p * 100)}%`;

export function clockOf(simMin: number): string {
  const t = Math.floor(((simMin % 1440) + 1440) % 1440);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function elapsed(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function minutes(m: number | null | undefined): string {
  if (m === null || m === undefined || !isFinite(m)) return 'n/a';
  if (m < 1) return 'under 1 min';
  if (m < 90) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}

export function signed(m: number | null): string {
  if (m === null) return 'n/a';
  const r = Math.round(m);
  return r === 0 ? '0 min' : r > 0 ? `+${r} min` : `${r} min`;
}

export function knots(mps: number): string {
  return `${(mps / 0.514444).toFixed(1)} kn`;
}

export function toward(deg: number | null): string {
  return deg === null ? '' : compassPoint(deg);
}

export function wallTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ago(fromMs: number, nowMs: number): string {
  const m = Math.floor((nowMs - fromMs) / 60000);
  if (m < 1) return 'just now';
  if (m === 1) return '1 min ago';
  return `${m} min ago`;
}
