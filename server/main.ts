import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import QRCode from 'qrcode';
import gridJson from '../src/data/harbor_grid.json';
import { defaultSettings } from '../src/engine/settings';
import { buildHarbor } from '../src/engine/harbor';
import { createWorld, type AisInputVessel } from '../src/engine/world';
import { distanceField, nearestWater } from '../src/engine/grid';
import { knotsToMps, type LonLat } from '../src/engine/geo';
import { clockLabel } from '../src/engine/eta';
import type { CommandEvents, CaptainEvents, OnTimeRow } from '../src/shared/protocol';
import { openAuditLog } from './audit';
import { createPushService } from './push';
import { createLanguageModel } from './llm';
import { createSmsService } from './sms';
import { joinUrls, lanAddresses } from './net';
import { createAisFeed, type FeedMode } from './ais/live';
import { berthedAt } from './ais/berth';
import { onTimeBoard } from './ais/ontime';
import { createNoaaClient } from './noaa/client';
import type { AisVessel } from '../src/shared/ais-types';
import type { AisSettings } from './ais/settings';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const DEV = flag('dev');
const PORT = Number(process.env.PORT || option('port', '5170'));
const HTTPS_PORT = PORT + 1;
const AIS_MODE = option('ais', process.env.AIS_MODE || 'auto') as FeedMode;
const PUBLIC_URL = process.env.PUBLIC_URL || null;
const settings = defaultSettings;
const harbor = buildHarbor(gridJson as never, settings);
const world = createWorld({ harbor, settings });
const audit = openAuditLog();
const push = createPushService();
const language = createLanguageModel(settings.language);
const noaa = createNoaaClient();
const sms = createSmsService();
world.settings = { ...world.settings, channels: { ...world.settings.channels, sms: sms.ready } };

const certDir = path.resolve('certs');
const hasCerts = fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem'));
const urls = () => joinUrls(PORT, hasCerts ? HTTPS_PORT : null, PUBLIC_URL);
world.link = urls()[0];
world.setSources({ push: { ready: push.ready, detail: `${push.detail}. ${sms.detail}` } });

const fieldCache = new Map<number, Float32Array>();
function routeMinutes(from: LonLat, to: LonLat, speedKn: number): number | null {
  const g = harbor.grid;
  const cellOf = (p: LonLat) => { const [x, y] = g.toCell(p[0], p[1]); return g.inBounds(x, y) ? nearestWater(g, x, y, 8) : -1; };
  const a = cellOf(from), b = cellOf(to);
  if (a < 0 || b < 0 || speedKn <= 0) return null;
  let D = fieldCache.get(b);
  if (!D) { D = distanceField(g, b); fieldCache.set(b, D); }
  return isFinite(D[a]) ? (D[a] * g.cellMeters) / knotsToMps(speedKn) / 60 : null;
}

let aisVessels: AisVessel[] = [];
let aisOnTime: OnTimeRow[] = [];
const feed = createAisFeed({
  settings: settings as unknown as AisSettings,
  mode: AIS_MODE,
  recording: settings.ais.recording,
  onVessels: (vs) => {
    aisVessels = vs;
    world.setAis(vs.map((v): AisInputVessel => ({
      mmsi: v.mmsi, name: v.name, lat: v.lat, lon: v.lon, sogKn: v.sogKn ?? 0, cogDeg: v.cogDeg ?? v.headingDeg ?? 0,
      headingDeg: v.headingDeg, typeLabel: v.typeLabel, lengthM: v.lengthM, aisClass: v.aisClass, source: v.source,
    })));
  },
  onStatus: (s) => {
    world.setSources({ ais: { mode: s.mode, detail: s.detail, vessels: aisVessels.length } });
    world.log('system', 'AIS source', s.detail);
  },
});

function refreshOnTime(): void {
  try {
    const rows = onTimeBoard(aisVessels, { routeMinutes, now: Date.now(), settings: settings as never });
    aisOnTime = rows.slice(0, 40).map((r) => ({
      id: `ais-${r.mmsi}`, name: r.name || `MMSI ${r.mmsi}`, type: r.typeLabel, source: aisVessels.find((v) => v.mmsi === r.mmsi)?.source === 'live' ? 'ais-live' : 'ais-replay',
      destination: r.destination || (r.port === 'LA' ? 'Los Angeles' : 'Long Beach'),
      plannedLabel: r.reportedEta ? shortTime(r.reportedEta) : 'not reported', ourEtaLabel: r.ourEta ? shortTime(r.ourEta) : 'n/a',
      deltaMin: r.deltaMin, status: r.status, why: r.why,
    }));
    const cruise = harbor.targets.find((t) => t.id === 'cruise');
    if (cruise) {
      const ship = berthedAt(aisVessels, cruise, settings.ais as never);
      world.setBerth(!!ship, ship?.name ?? null);
    }
    world.setSources({ ais: { ...world.sources.ais, vessels: aisVessels.length } });
  } catch (err) {
    world.log('system', 'On-time board error', (err as Error).message);
  }
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Los_Angeles' });
}

async function refreshNoaa(): Promise<void> {
  try {
    const c = await noaa.getCurrent();
    if (c) {
      world.setCurrent({ u: c.u, v: c.v, speedMps: c.speedMps, towardDeg: c.towardDeg });
      world.setSources({ noaa: { source: c.source, detail: `${c.stationName} (${c.station}), ${c.basis} current, ${c.source === 'live' ? 'fetched now' : c.source === 'cache' ? 'from cache' : 'from the saved snapshot'}`, currentKn: c.speedMps / 0.514444, towardDeg: c.towardDeg, observedAt: c.observedAt } });
    } else {
      world.setSources({ noaa: { source: 'none', detail: 'No current data; the drift hypothesis is off', currentKn: null, towardDeg: null, observedAt: null } });
    }
  } catch (err) {
    world.setSources({ noaa: { source: 'none', detail: `NOAA unavailable: ${(err as Error).message}`, currentKn: null, towardDeg: null, observedAt: null } });
  }
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, clock: clockLabel(world.simMin), sources: world.sources }));
app.get('/api/push-key', (_req, res) => res.json({ publicKey: push.publicKey }));
app.get('/api/join', async (_req, res) => {
  const base = urls();
  const phones = world.craft.filter((c) => c.phone);
  const out = await Promise.all(phones.map(async (c) => {
    const url = `${base[0]}?v=${c.id}`;
    return { vesselId: c.id, name: c.name, type: c.type, url, svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }), joined: world.captains.get(c.id)?.connected ?? false };
  }));
  res.json({ urls: base, phones: out, any: { url: base[0], svg: await QRCode.toString(base[0], { type: 'svg', margin: 1 }) } });
});
app.get('/api/audit', (_req, res) => res.json(audit.recent(500)));
app.post('/api/orders/draft', async (req, res) => {
  const rule = await language.draftOrder(String(req.body?.text ?? '').slice(0, 400));
  res.json({ rule, source: rule ? 'granite' : 'none' });
});

const httpServer = http.createServer(app);
const servers: (http.Server | https.Server)[] = [httpServer];
if (hasCerts) servers.push(https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, app));

const io = new Server({ serveClient: false, cors: { origin: true }, pingInterval: 5000, pingTimeout: 8000 });
for (const s of servers) io.attach(s);

function emitCommand(): void {
  io.to('command').emit('snapshot', world.commandSnapshot({ aisOnTime, joinUrls: urls() }));
}

function emitCaptains(): void {
  for (const vesselId of world.captains.keys()) io.to(`v:${vesselId}`).emit('snapshot', world.captainSnapshot(vesselId));
}

function flushEffects(): void {
  const fx = world.drainEffects();
  if (fx.audit.length) audit.append(fx.audit);
  for (const id of fx.undone) audit.markUndone(id);
  for (const p of fx.pushes) {
    if (!push.hasSubscription(p.vesselId)) continue;
    void push.send(p.vesselId, { title: p.title, body: p.body, tag: p.tag, url: p.url, priority: p.priority, requireInteraction: p.priority === 'P1' }).then((ok) => {
      if (ok) world.log('machine', 'Push sent', `${p.priority} to ${world.craft.find((c) => c.id === p.vesselId)?.name ?? p.vesselId}`);
      world.setSources({ push: { ready: push.ready, detail: push.detail } });
    });
  }
  for (const r of fx.resends) {
    const viaPush = push.hasSubscription(r.vesselId)
      ? push.send(r.vesselId, { title: `ACT NOW: ${r.text.split(': ')[1] ?? r.text}`, body: r.text, tag: r.noticeId, url: `/captain?notice=${r.noticeId}`, priority: r.priority, requireInteraction: true })
      : Promise.resolve(false);
    void viaPush.then(async (ok) => {
      if (ok) { world.recordResend(r.noticeId, r.vesselId, 'push'); return; }
      const texted = await sms.send(r.vesselId, r.text);
      world.recordResend(r.noticeId, r.vesselId, texted ? 'sms' : null);
    });
  }
  for (const w of fx.wording) {
    void language.word(w.facts, w.template).then((wording) => { world.applyWording(w.draftId, wording, w.key === 'notice' ? undefined : w.key); emitCommand(); }).catch(() => undefined);
  }
  world.setSources({ language: language.status() });
}

const COMMAND_EVENTS: (keyof CommandEvents)[] = ['drive', 'spawn', 'removeContact', 'contactParams', 'sensorLoss', 'editDraft', 'publish', 'discardDraft', 'dropZone', 'allClear', 'cardAction', 'clock', 'undo', 'signOrders', 'officer', 'reset', 'markVhfCalled'];
const STEERING_EVENTS = new Set<keyof CommandEvents>(['drive', 'contactParams']);

function bindCommand(socket: Socket): void {
  socket.join('command');
  for (const name of COMMAND_EVENTS) {
    socket.on(name, (payload: unknown, ack?: (r: unknown) => void) => {
      try {
        world.handle(name, payload as never);
        flushEffects();
        emitCommand();
        if (!STEERING_EVENTS.has(name)) emitCaptains();
        ack?.({ ok: true });
      } catch (err) {
        world.log('system', 'Command error', `${name}: ${(err as Error).message}`);
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
  }
  socket.emit('snapshot', world.commandSnapshot({ aisOnTime, joinUrls: urls() }));
}

function bindCaptain(socket: Socket): void {
  socket.on('join', (payload: CaptainEvents['join'], ack?: (r: unknown) => void) => {
    const assigned = world.captainJoin(payload?.vesselId);
    if (!assigned) { ack?.({ ok: false, error: 'No vessel available' }); return; }
    const previous = socket.data.vesselId as string | undefined;
    if (previous && previous !== assigned.vesselId) {
      socket.leave(`v:${previous}`);
      const room = io.sockets.adapter.rooms.get(`v:${previous}`);
      if (!room || room.size === 0) world.captainLeft(previous);
    }
    socket.data.vesselId = assigned.vesselId;
    socket.join(`v:${assigned.vesselId}`);
    ack?.({ ok: true, ...assigned, pushKey: push.publicKey });
    socket.emit('snapshot', world.captainSnapshot(assigned.vesselId));
    flushEffects();
    emitCommand();
  });
  const on = (kind: 'delivered' | 'seen' | 'gotIt') => socket.on(kind, (payload: CaptainEvents['gotIt'], ack?: (r: unknown) => void) => {
    const claimed = typeof payload?.vesselId === 'string' && world.captains.has(payload.vesselId) ? payload.vesselId : undefined;
    const vesselId = (socket.data.vesselId as string | undefined) ?? claimed;
    if (!vesselId || typeof payload?.noticeId !== 'string') return;
    world.captainEvent(vesselId, kind, payload.noticeId);
    flushEffects();
    emitCommand();
    socket.emit('snapshot', world.captainSnapshot(vesselId));
    ack?.({ ok: true });
  });
  on('delivered');
  on('seen');
  on('gotIt');
  socket.on('pushSubscription', (payload: CaptainEvents['pushSubscription']) => {
    const claimed = typeof payload?.vesselId === 'string' && world.captains.has(payload.vesselId) ? payload.vesselId : undefined;
    const vesselId = (socket.data.vesselId as string | undefined) ?? claimed;
    if (!vesselId || !payload?.subscription) return;
    push.subscribe(vesselId, payload.subscription as never);
    world.log(`captain:${vesselId}`, 'Push enabled', `${world.craft.find((c) => c.id === vesselId)?.name ?? vesselId} turned on notifications`);
  });
  socket.on('disconnect', () => {
    const vesselId = socket.data.vesselId as string | undefined;
    if (!vesselId) return;
    const room = io.sockets.adapter.rooms.get(`v:${vesselId}`);
    if (!room || room.size === 0) world.captainLeft(vesselId);
  });
}

io.on('connection', (socket) => {
  const role = socket.handshake.auth?.role;
  if (role === 'command') bindCommand(socket);
  else bindCaptain(socket);
});

let last = Date.now();
let lastTickError = '';
function guarded(name: string, fn: () => void): () => void {
  return () => {
    try {
      fn();
    } catch (err) {
      const message = `${name}: ${(err as Error).message}`;
      if (message !== lastTickError) { lastTickError = message; console.error(`Hub kept running after an error in ${message}`); world.log('system', 'Hub error', message); }
    }
  };
}
setInterval(guarded('tick', () => {
  const now = Date.now();
  const dt = now - last;
  last = now;
  world.tick(dt, now);
  flushEffects();
}), settings.sim.tickMs);
setInterval(guarded('command update', emitCommand), 250);
setInterval(guarded('phone update', emitCaptains), 400);
setInterval(refreshOnTime, 5000);
setInterval(() => void refreshNoaa(), 10 * 60_000);
void refreshNoaa();
setTimeout(refreshOnTime, 2500);

async function attachFrontend(): Promise<void> {
  if (DEV) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
    app.use(vite.middlewares);
    return;
  }
  const dist = path.resolve('dist');
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await attachFrontend();
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log(`GIVE WAY hub on http://localhost:${PORT}${ips.length ? `  (LAN ${ips.map((ip) => `http://${ip}:${PORT}`).join(', ')})` : ''}`);
  if (hasCerts) console.log(`HTTPS on port ${HTTPS_PORT} for phones that need push and offline install`);
  console.log(`AIS mode ${AIS_MODE}; language: ${language.status().detail}`);
});
if (servers[1]) servers[1].listen(HTTPS_PORT, '0.0.0.0');

function shutdown(): void {
  feed.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
