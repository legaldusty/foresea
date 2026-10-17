const FEET_PER_METER = 3.28084;
const KNOT_MPS = 0.514444;
const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const feet = (m: number): string => (m * FEET_PER_METER).toFixed(1);

export const knotsWhole = (mps: number): string => String(Math.round(mps / KNOT_MPS));

export const fahrenheit = (c: number): string => String(Math.round((c * 9) / 5 + 32));

export function compass16(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '';
  return COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function ageText(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return 'age unknown';
  if (min < 1) return 'under 1 min ago';
  if (min < 90) return `${Math.round(min)} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${Math.round(min - h * 60)} min ago`;
}

export function shortSource(source: string): string {
  return source.replace(/ (wind|air temperature|pressure|tide)(?=,|$)/, '').replace(/, last \d+ min$/, '');
}
