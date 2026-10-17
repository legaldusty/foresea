export function etaMinutes(cells: number, cellMeters: number, speedMps: number): number | null {
  if (!isFinite(cells) || speedMps <= 0) return null;
  return (cells * cellMeters) / speedMps / 60;
}

export function clockLabel(simMinutes: number): string {
  const total = Math.floor(((simMinutes % 1440) + 1440) % 1440);
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function minutesLabel(min: number | null): string {
  if (min === null || !isFinite(min)) return 'n/a';
  if (min < 1) return 'under 1 min';
  if (min < 90) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h} h ${m} min`;
}

export function signedMinutes(min: number): string {
  const r = Math.round(min);
  if (r === 0) return 'on time';
  return r > 0 ? `+${r} min` : `${r} min`;
}

export function isNight(simMinutes: number, nightStartHour: number, nightEndHour: number): boolean {
  const hour = (((simMinutes % 1440) + 1440) % 1440) / 60;
  return nightStartHour > nightEndHour ? hour >= nightStartHour || hour < nightEndHour : hour >= nightStartHour && hour < nightEndHour;
}
