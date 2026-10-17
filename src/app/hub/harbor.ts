const KEY = 'giveway.harbor';
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

let current: string | null = null;

function stored(): string | null {
  try { const v = localStorage.getItem(KEY); return v && CODE.test(v) ? v : null; } catch { return null; }
}

function store(code: string | null): void {
  try { if (code) localStorage.setItem(KEY, code); else localStorage.removeItem(KEY); } catch { return; }
}

export function harborCode(): string | null {
  if (current) return current;
  const fromUrl = new URLSearchParams(location.search).get('h')?.toUpperCase() ?? null;
  current = fromUrl && CODE.test(fromUrl) ? fromUrl : stored();
  return current;
}

export function adoptHarbor(code: string | null): void {
  current = code;
  store(code);
  const url = new URL(location.href);
  if (code) url.searchParams.set('h', code);
  else url.searchParams.delete('h');
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

export function api(path: string): string {
  const code = harborCode();
  return code ? `${path}${path.includes('?') ? '&' : '?'}h=${code}` : path;
}

export function viewPath(path: string): string {
  const code = harborCode();
  if (!code) return path;
  const [base, query] = path.split('?');
  const params = new URLSearchParams(query ?? '');
  params.set('h', code);
  return `${base}?${params.toString()}`;
}
