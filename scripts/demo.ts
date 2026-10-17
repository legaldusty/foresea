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

async function startTunnel(): Promise<string | null> {
  if (!which('cloudflared')) { console.log('Tunnel skipped: cloudflared is not installed (brew install cloudflared).'); return null; }
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 20_000);
    const scan = (buf: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
  });
}

async function waitForHub(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api/health`); if (r.ok) return true; } catch { await new Promise((ok) => setTimeout(ok, 500)); }
  }
  return false;
}

async function main(): Promise<void> {
  if (!has('no-build')) run('npx', ['vite', 'build'], 'Build');
  const publicUrl = has('tunnel') ? await startTunnel() : null;
  const env = { ...process.env, PORT: String(PORT), ...(publicUrl ? { PUBLIC_URL: publicUrl } : {}) };
  const hubArgs = ['tsx', 'server/main.ts'];
  if (has('replay')) hubArgs.push('--ais', 'replay');
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
