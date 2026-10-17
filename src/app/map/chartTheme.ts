export interface ChartColors {
  water: string;
  shallows: string;
  land: string;
  landEdge: string;
  chartLine: string;
  text: string;
  muted: string;
  tide: string;
  you: string;
  riskLow: string;
  riskMedium: string;
  riskSerious: string;
  riskHigh: string;
  riskCritical: string;
  panel: string;
  bg: string;
}

const FALLBACK: Record<'night' | 'day', ChartColors> = {
  night: {
    water: '#080F18', shallows: '#0E1A29', land: '#1B1E24', landEdge: '#333842', chartLine: '#26313F', text: '#E7EAEE', muted: '#A6ABB4',
    tide: '#386BE2', you: '#4D7FF1', riskLow: '#7A808B', riskMedium: '#E3AD4B', riskSerious: '#E1773B', riskHigh: '#DE4F46', riskCritical: '#B63039',
    panel: '#0E1116', bg: '#080A0E',
  },
  day: {
    water: '#F6FAFD', shallows: '#D5EAF7', land: '#EDE7DB', landEdge: '#C5BDAD', chartLine: '#ADC1CF', text: '#141820', muted: '#505660',
    tide: '#2C5FDD', you: '#2C5FDD', riskLow: '#6F757F', riskMedium: '#F0B135', riskSerious: '#F0772D', riskHigh: '#D73431', riskCritical: '#9E1326',
    panel: '#FBFCFD', bg: '#F5F7F9',
  },
};

const VAR_NAMES: Record<keyof ChartColors, string[]> = {
  water: ['--water'], shallows: ['--shallows'], land: ['--land'], landEdge: ['--land-edge', '--landEdge'], chartLine: ['--chart-line', '--chartLine'],
  text: ['--text'], muted: ['--muted'], tide: ['--tide'], you: ['--you'], riskLow: ['--risk-low', '--riskLow'], riskMedium: ['--risk-medium', '--riskMedium'],
  riskSerious: ['--risk-serious', '--riskSerious'], riskHigh: ['--risk-high', '--riskHigh'], riskCritical: ['--risk-critical', '--riskCritical'],
  panel: ['--panel'], bg: ['--bg'],
};

export function chartColors(theme: 'night' | 'day', el: Element = document.documentElement): ChartColors {
  const style = getComputedStyle(el);
  const out = { ...FALLBACK[theme] };
  for (const key of Object.keys(VAR_NAMES) as (keyof ChartColors)[]) {
    for (const name of VAR_NAMES[key]) {
      const v = style.getPropertyValue(name).trim();
      if (v) { out[key] = v; break; }
    }
  }
  return out;
}

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
