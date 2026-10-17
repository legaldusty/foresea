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
    water: '#0C1A25', shallows: '#12283A', land: '#1B2A36', landEdge: '#2C4053', chartLine: '#24405A', text: '#E8EEF2', muted: '#8FA3B3',
    tide: '#0F8B8D', you: '#3D7DD8', riskLow: '#8A9BA8', riskMedium: '#E0A100', riskSerious: '#E8712B', riskHigh: '#D83A34', riskCritical: '#A4161A',
    panel: '#0F2030', bg: '#0A1621',
  },
  day: {
    water: '#F8FAF9', shallows: '#D6E8EF', land: '#E8DCC0', landEdge: '#CDBE9A', chartLine: '#D9D2C3', text: '#0F1B26', muted: '#5B6B78',
    tide: '#0F8B8D', you: '#1F5FBF', riskLow: '#8A9BA8', riskMedium: '#E0A100', riskSerious: '#E8712B', riskHigh: '#D83A34', riskCritical: '#A4161A',
    panel: '#EDE7DA', bg: '#F6F3EC',
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
