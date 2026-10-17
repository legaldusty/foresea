import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import QRCode from 'qrcode';
import { lanAddresses } from '../server/net';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(`--${f}`);
const PORT = Number(process.env.PORT || 5170);
const children: ChildProcess[] = [];

function run(cmd: string, argv: string[], label: string): void {
  const r = spawnSync(cmd, argv, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${label} failed`); process.exit(r.status ?? 1); }
}

function which(bin: string): boolean {
  return spawnSync('which', [bin], { encoding: 'utf8' }).status === 0;
}

const TUNNEL_WAIT_MS = 45_000;
const TUNNEL_TRIES = 2;

function tryTunnel(): Promise<{ url: string | null; log: string }> {
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  return new Promise((resolve) => {
    const finish = (url: string | null) => {
      clearTimeout(timer);
      if (url) children.push(child); else child.kill('SIGTERM');
      resolve({ url, log });
    };
    const timer = setTimeout(() => finish(null), TUNNEL_WAIT_MS);
    const scan = (buf: Buffer) => {
      log += buf.toString();
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log);
      if (m) finish(m[0]);
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('exit', () => finish(null));
  });
}

async function startTunnel(): Promise<string | null> {
  if (!which('cloudflared')) { console.log('Tunnel skipped: cloudflared is not installed (brew install cloudflared).'); return null; }
  for (let attempt = 1; attempt <= TUNNEL_TRIES; attempt++) {
    console.log(`Starting the Cloudflare tunnel (try ${attempt} of ${TUNNEL_TRIES})...`);
    const { url, log } = await tryTunnel();
    if (url) { console.log(`Tunnel up: ${url}`); return url; }
    const errors = log.split('\n').filter((l) => / ERR | WRN |error|failed/i.test(l)).slice(-4);
    console.log(`No tunnel URL within ${TUNNEL_WAIT_MS / 1000} s.${errors.length ? `\n${errors.join('\n')}` : ''}`);
  }
  console.log('Tunnel failed. Phones must use the LAN address below and be on the same network as this laptop.');
  return null;
}

async function waitForHub(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api/health`); if (r.ok) return true; } catch { await new Promise((ok) => setTimeout(ok, 500)); }
  }
  return false;
}

async function hubAlreadyRunning(): Promise<boolean> {
  try { return (await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

async function main(): Promise<void> {
  if (await hubAlreadyRunning()) {
    console.error(`A GIVE WAY hub is already running on port ${PORT}. Stop it first (Ctrl+C in its terminal), then run this again.`);
    console.error('Rebuilding while it runs can hand phones and browsers a half-written chart file.');
    process.exit(1);
  }
  if (!has('no-build')) run('npx', ['vite', 'build'], 'Build');
  const publicUrl = has('tunnel') ? await startTunnel() : null;
  const env = { ...process.env, PORT: String(PORT), ...(publicUrl ? { PUBLIC_URL: publicUrl } : {}) };
  const hubArgs = ['tsx', 'server/main.ts'];
  if (has('replay')) hubArgs.push('--ais', 'replay');
  if (has('sim')) hubArgs.push('--sim');
  const hub = spawn('npx', hubArgs, { stdio: 'inherit', env });
  children.push(hub);
  if (!(await waitForHub())) { console.error('The hub did not start.'); process.exit(1); }
  const ip = lanAddresses()[0];
  const join = publicUrl ? `${publicUrl}/captain` : `http://${ip ?? 'localhost'}:${PORT}/captain`;
  console.log('\nCommand:  http://localhost:' + PORT + '/');
  console.log('Captain:  ' + join);
  if (!ip) console.log('No LAN address found. Join the team hotspot so phones can reach this laptop.');
  console.log('\nScan to join as a captain:\n');
  console.log(await QRCode.toString(join, { type: 'terminal', small: true }));
  if (!has('no-open')) spawn('open', [`http://localhost:${PORT}/`], { stdio: 'ignore' });
}

function stop(): void {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
void main();
