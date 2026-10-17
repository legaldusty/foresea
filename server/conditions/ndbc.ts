import { getText, type FetchContext, type Observation } from './http';

export const NDBC_REALTIME = 'https://www.ndbc.noaa.gov/data/realtime2';
const MISSING = 'MM';
const DATE_COLUMNS = 5;

export interface NdbcRow { at: number; values: Record<string, number | null> }

export interface BuoyReading {
  id: string;
  name: string;
  newestRowAt: string | null;
  waveHeightM: Observation | null;
  dominantPeriodS: Observation | null;
  waveFromDeg: Observation | null;
  waterTempC: Observation | null;
}

export function parseNdbcRealtime(text: string): NdbcRow[] {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith('#YY'));
  if (!header) throw new Error('sent a file with no #YY header row');
  const columns = header.slice(1).trim().split(/\s+/);
  const rows: NdbcRow[] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cells = line.trim().split(/\s+/);
    if (cells.length < columns.length) continue;
    const [yy, mo, dd, hh, mi] = cells.slice(0, DATE_COLUMNS).map(Number);
    const at = Date.UTC(yy, mo - 1, dd, hh, mi);
    if (!Number.isFinite(at)) continue;
    const values: Record<string, number | null> = {};
    for (let i = DATE_COLUMNS; i < columns.length; i++) {
      const raw = cells[i];
      const n = raw === MISSING ? NaN : Number(raw);
      values[columns[i]] = Number.isFinite(n) ? n : null;
    }
    rows.push({ at, values });
  }
  return rows.sort((a, b) => b.at - a.at);
}

export function newestValue(rows: NdbcRow[], column: string, notBefore: number): Observation | null {
  for (const row of rows) {
    if (row.at < notBefore) break;
    const v = row.values[column];
    if (v !== null && v !== undefined) return { value: v, at: new Date(row.at).toISOString() };
  }
  return null;
}

export function buoyReading(id: string, name: string, rows: NdbcRow[], now: number, maxAgeMinutes: number): BuoyReading {
  const notBefore = now - maxAgeMinutes * 60_000;
  return {
    id,
    name,
    newestRowAt: rows.length ? new Date(rows[0].at).toISOString() : null,
    waveHeightM: newestValue(rows, 'WVHT', notBefore),
    dominantPeriodS: newestValue(rows, 'DPD', notBefore),
    waveFromDeg: newestValue(rows, 'MWD', notBefore),
    waterTempC: newestValue(rows, 'WTMP', notBefore),
  };
}

export function buoyObservedAt(b: BuoyReading): string | null {
  const times = [b.waveHeightM, b.dominantPeriodS, b.waveFromDeg, b.waterTempC].filter((o): o is Observation => o !== null).map((o) => o.at);
  return times.sort().pop() ?? null;
}

export async function fetchBuoy(ctx: FetchContext, buoy: { id: string; name: string }, maxAgeMinutes: number): Promise<BuoyReading> {
  const text = await getText(ctx, `${NDBC_REALTIME}/${encodeURIComponent(buoy.id)}.txt`);
  return buoyReading(buoy.id, buoy.name, parseNdbcRealtime(text), ctx.now, maxAgeMinutes);
}
