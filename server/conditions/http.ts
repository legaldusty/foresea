export interface TextResponse { ok: boolean; status: number; text(): Promise<string> }

export type TextFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<TextResponse>;

export interface FetchContext { fetch: TextFetch; timeoutMs: number; userAgent: string; now: number }

export interface SourceStatus { ok: boolean; detail: string; observedAt: string | null }

export interface Observation { value: number; at: string }

function failureReason(err: unknown, timeoutMs: number): string {
  const e = err as Error;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `timed out after ${Math.round(timeoutMs / 1000)} s`;
  return `unreachable (${e?.message ?? 'network error'})`;
}

export async function getText(ctx: FetchContext, url: string, accept = 'text/plain'): Promise<string> {
  let response: TextResponse;
  try {
    response = await ctx.fetch(url, { signal: AbortSignal.timeout(ctx.timeoutMs), headers: { 'User-Agent': ctx.userAgent, Accept: accept } });
  } catch (err) {
    throw new Error(failureReason(err, ctx.timeoutMs));
  }
  if (!response.ok) throw new Error(`answered HTTP ${response.status}`);
  try {
    return await response.text();
  } catch (err) {
    throw new Error(failureReason(err, ctx.timeoutMs));
  }
}

export async function getJson(ctx: FetchContext, url: string, accept = 'application/json'): Promise<unknown> {
  const text = await getText(ctx, url, accept);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('sent a reply that is not JSON');
  }
}

export function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function freshEnough(at: string | null | undefined, now: number, maxAgeMinutes: number): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t <= maxAgeMinutes * 60_000;
}
