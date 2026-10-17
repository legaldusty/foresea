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
import { createWorld, type AisInputVessel, type World } from '../src/engine/world';
import { distanceField, nearestWater } from '../src/engine/grid';
import { knotsToMps, type LonLat } from '../src/engine/geo';
import { clockLabel } from '../src/engine/eta';
import type { CommandEvents, CaptainEvents, OnTimeRow, SensorIngestResult } from '../src/shared/protocol';
import { capAlert, capFeed, feedOptions, zonesGeoJson } from '../src/engine/cap';
import { PILOT_REQUESTS, pilotDecision } from '../src/engine/pilot';
import { parseDetections, sensorAccess } from './sensor';
import { openAuditLog } from './audit';
import { createPushService } from './push';
import { createLanguageModel, readTypedOrder } from './llm';
import { createSmsService } from './sms';
import { joinUrls, lanAddresses } from './net';
import { createAisFeed, type FeedMode } from './ais/live';
import { berthedAt } from './ais/berth';
import { sightingsCsv, sightingsGeoJson } from '../src/engine/tuesday';
import { onTimeBoard } from './ais/ontime';
import { createTrafficIntel } from './ais/intel';
import { createNoaaClient } from './noaa/client';
import { createConditionsClient } from './conditions/client';
import type { AisVessel } from '../src/shared/ais-types';
import type { AisSettings } from './ais/settings';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const DEV = flag('dev');
const PORT = Number(process.env.PORT || option('port', '5170'));
const HTTPS_PORT = PORT + 1;
const AIS_MODE = option('ais', process.env.AIS_MODE || 'auto') as FeedMode;
const PUBLIC_URL = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : null;
const PRIVATE = flag('private') || process.env.GIVEWAY_PRIVATE === '1';
const START_SIM = flag('sim');
const MAIN = 'main';
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const settings = defaultSettings;
const harbor = buildHarbor(gridJson as never, settings);
const audit = openAuditLog(process.env.GIVEWAY_AUDIT || undefined);
const push = createPushService();
const language = createLanguageModel(settings.language);
const noaa = createNoaaClient();
const sms = createSmsService();

const certDir = path.resolve('certs');
const hasCerts = fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem'));

function withHarbor(url: string, code: string): string {
  if (code === MAIN) return url;
  return `${url}${url.includes('?') ? '&' : '?'}h=${code}`;
}

function urls(code = MAIN): string[] {
  const base = PRIVATE && PUBLIC_URL ? [`${PUBLIC_URL}/captain`] : joinUrls(PORT, hasCerts ? HTTPS_PORT : null, PUBLIC_URL);
  return base.map((u) => withHarbor(u, code));
}

function readCalibration(): { value: unknown; broken: boolean } {
  const file = path.resolve('data/cache/calibration.json');
  if (!fs.existsSync(file)) return { value: null, broken: false };
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')), broken: false };
  } catch {
    return { value: null, broken: true };
  }
}
const calibration = readCalibration();

interface SharedFeeds {
  ais: AisInputVessel[] | null;
  current: Parameters<World['setCurrent']>[0] | null;
  sources: Partial<World['sources']>;
  berth: { docked: boolean; ship: string | null } | null;
  intel: World['vesselIntel'] | null;
  traffic: unknown;
}
const shared: SharedFeeds = { ais: null, current: null, sources: {}, berth: null, intel: null, traffic: null };

interface HarborRoom {
  code: string;
  world: World;
  forecastKey: string;
  tickCount: number;
  last: number;
  lastSeen: number;
  sockets: number;
}
const harbors = new Map<string, HarborRoom>();

function makeWorld(code: string): World {
  const w = createWorld({ harbor, settings });
  w.settings = { ...w.settings, channels: { ...w.settings.channels, sms: sms.ready } };
  w.link = urls(code)[0];
  if (calibration.value) w.modelFacts = { ...w.modelFacts, calibration: calibration.value as never };
  if (calibration.broken) w.log('system', 'Models', 'Calibration facts could not be read; run npm run calibration');
  w.setSources({ push: { ready: push.ready, detail: `${push.detail}. ${sms.detail}` } });
  if (!START_SIM) w.resetHarbor('live');
  if (shared.current) w.setCurrent(shared.current);
  if (Object.keys(shared.sources).length) w.setSources(shared.sources);
  if (shared.ais) w.setAis(shared.ais);
  if (shared.berth) w.setBerth(shared.berth.docked, shared.berth.ship);
  if (shared.intel) w.vesselIntel = shared.intel;
  if (shared.traffic) w.modelFacts = { ...w.modelFacts, traffic: shared.traffic as never };
  w.setConditions(conditions.view());
  return w;
}

function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!harbors.has(c)) return c;
  }
}

function openHarbor(code: string): HarborRoom {
  const room: HarborRoom = { code, world: makeWorld(code), forecastKey: '', tickCount: 0, last: Date.now(), lastSeen: Date.now(), sockets: 0 };
  harbors.set(code, room);
  if (code !== MAIN) console.log(`Private harbor ${code} opened (${harbors.size - 1} private open)`);
  return room;
}

function evictIdle(force: boolean): boolean {
  const limit = settings.hosting.idleMinutes * 60_000;
  const now = Date.now();
  let evicted = false;
  const idle = [...harbors.values()].filter((h) => h.code !== MAIN && h.sockets === 0).sort((a, b) => a.lastSeen - b.lastSeen);
  for (const h of idle) {
    if (!force && now - h.lastSeen < limit) continue;
    harbors.delete(h.code);
    evicted = true;
    console.log(`Private harbor ${h.code} closed after ${Math.round((now - h.lastSeen) / 60_000)} min idle`);
    if (force) return true;
  }
  return evicted;
}

function harborFor(requested: unknown, create: boolean): HarborRoom {
  const main = harbors.get(MAIN) as HarborRoom;
  if (!PRIVATE) return main;
  const code = typeof requested === 'string' ? requested.toUpperCase() : '';
  if (CODE.test(code)) {
    const found = harbors.get(code);
    if (found) return found;
    if (!create) return main;
  } else if (!create) return main;
  if (harbors.size - 1 >= settings.hosting.maxHarbors && !evictIdle(true)) return main;
  return openHarbor(CODE.test(code) ? code : newCode());
}

function reqHarbor(req: express.Request): HarborRoom {
  return harborFor(req.query.h, false);
}

function eachWorld(fn: (w: World) => void): void {
  for (const h of harbors.values()) fn(h.world);
}

function setSharedSources(sources: Partial<World['sources']>): void {
  shared.sources = { ...shared.sources, ...sources };
  eachWorld((w) => w.setSources(sources));
}

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

const conditions = createConditionsClient();
let aisVessels: AisVessel[] = [];
let aisOnTime: OnTimeRow[] = [];
openHarbor(MAIN);

const feed = createAisFeed({
  settings: settings as unknown as AisSettings,
  mode: AIS_MODE,
  recording: settings.ais.recording,
  onVessels: (vs) => {
    aisVessels = vs;
    shared.ais = vs.map((v): AisInputVessel => ({
      mmsi: v.mmsi, name: v.name, lat: v.lat, lon: v.lon, sogKn: v.sogKn ?? 0, cogDeg: v.cogDeg ?? v.headingDeg ?? 0,
      headingDeg: v.headingDeg, typeLabel: v.typeLabel, lengthM: v.lengthM, aisClass: v.aisClass, source: v.source, reportedAtMs: v.lastSeen,
      destination: v.destination, etaReported: v.etaReported, navStatus: v.navStatus.label,
    }));
    eachWorld((w) => w.setAis(shared.ais as AisInputVessel[]));
  },
  onStatus: (s) => {
    setSharedSources({ ais: { mode: s.mode, detail: s.detail, vessels: aisVessels.length } });
    eachWorld((w) => w.log('system', 'AIS source', s.detail));
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
      const ship = berthedAt(aisVessels.filter((v) => v.typeLabel === 'passenger'), cruise, settings);
      shared.berth = { docked: !!ship, ship: ship?.name ?? null };
      eachWorld((w) => w.setBerth(!!ship, ship?.name ?? null));
    }
    eachWorld((w) => w.setSources({ ais: { ...w.sources.ais, vessels: aisVessels.length } }));
  } catch (err) {
    eachWorld((w) => w.log('system', 'On-time board error', (err as Error).message));
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
      shared.current = { u: c.u, v: c.v, speedMps: c.speedMps, towardDeg: c.towardDeg };
      eachWorld((w) => w.setCurrent(shared.current as NonNullable<SharedFeeds['current']>));
      setSharedSources({ noaa: { source: c.source, detail: `${c.stationName} (${c.station}), ${c.basis} current, ${c.source === 'live' ? 'fetched now' : c.source === 'cache' ? 'from cache' : 'from the saved snapshot'}`, currentKn: c.speedMps / 0.514444, towardDeg: c.towardDeg, observedAt: c.observedAt } });
    } else {
      setSharedSources({ noaa: { source: 'none', detail: 'No current data; the drift hypothesis is off', currentKn: null, towardDeg: null, observedAt: null } });
    }
  } catch (err) {
    setSharedSources({ noaa: { source: 'none', detail: `NOAA unavailable: ${(err as Error).message}`, currentKn: null, towardDeg: null, observedAt: null } });
  }
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (req, res) => { const h = reqHarbor(req); res.json({ ok: true, clock: clockLabel(h.world.simMin), sources: h.world.sources, private: PRIVATE, harbors: harbors.size - 1 }); });
app.get('/api/push-key', (_req, res) => res.json({ publicKey: push.publicKey }));
app.get('/api/join', async (req, res) => {
  const h = reqHarbor(req);
  const base = urls(h.code);
  const phones = h.world.craft.filter((c) => c.phone);
  const out = await Promise.all(phones.map(async (c) => {
    const url = `${base[0]}${base[0].includes('?') ? '&' : '?'}v=${c.id}`;
    return { vesselId: c.id, name: c.name, type: c.type, url, svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }), joined: h.world.captains.get(c.id)?.connected ?? false };
  }));
  const driveUrl = base[0].replace(/\/captain(?=\?|$)/, '/drive');
  res.json({
    urls: base, phones: out, any: { url: base[0], svg: await QRCode.toString(base[0], { type: 'svg', margin: 1 }) },
    drive: { url: driveUrl, svg: await QRCode.toString(driveUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) },
    harbor: h.code === MAIN ? null : h.code,
  });
});
app.get('/api/audit', (req, res) => { const h = reqHarbor(req); res.json(h.code === MAIN ? audit.recent(500) : h.world.audit.slice(-500).reverse()); });
app.get('/api/sightings.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="giveway-sightings.csv"');
  res.send(sightingsCsv(reqHarbor(req).world.commandSnapshot().sightings));
});
app.get('/api/sightings.geojson', (req, res) => {
  res.setHeader('Content-Type', 'application/geo+json');
  res.setHeader('Content-Disposition', 'attachment; filename="giveway-sightings.geojson"');
  res.send(JSON.stringify(sightingsGeoJson(reqHarbor(req).world.commandSnapshot().sightings)));
});
app.get('/api/report.csv', (req, res) => {
  const r = reqHarbor(req).world.dailyReport();
  const rows = [['measure', 'value'], ['period', r.dayLabel], ['zones issued', r.zonesIssued], ['boats notified', r.boatsNotified], ['acknowledged', r.acknowledged], ['acknowledgment rate', r.ackRate === null ? '' : r.ackRate.toFixed(2)], ['minutes of delay caused', r.delayMinutes], ['large ships in whale zones', r.whaleShips], ['at or under the whale speed', r.whaleHonored], ['sightings today', r.sightings], ['share from the simulated schedule', r.simulatedShare.toFixed(2)]];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="giveway-daily-report.csv"');
  res.send(rows.map((row) => row.map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n'));
});
app.get('/api/board.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(reqHarbor(req).world.publicBoard());
});

app.get('/api/incident/:id', (req, res) => {
  const report = reqHarbor(req).world.incidentReport(String(req.params.id));
  if (!report) { res.status(404).json({ error: 'No incident with that id' }); return; }
  res.json(report);
});

app.post('/api/orders/draft', async (req, res) => {
  res.json(await readTypedOrder(String(req.body?.text ?? ''), settings, reqHarbor(req).world.signedOrders.orders, language));
});
app.post('/api/sensor/detections', (req, res) => {
  const h = reqHarbor(req);
  const access = sensorAccess({ configuredKey: process.env.GIVEWAY_SENSOR_KEY, providedKey: req.get('x-giveway-key'), remoteAddress: req.socket.remoteAddress, headers: req.headers });
  if (!access.ok) { res.status(access.status).json({ ok: false, error: access.error }); return; }
  if (!req.is('application/json')) { res.status(400).json({ ok: false, error: 'Send the detections as JSON with Content-Type: application/json' }); return; }
  const parsed = parseDetections(req.body, { maxBatch: settings.sensorFeed.maxBatch, maxIdLength: settings.sensorFeed.maxIdLength, bbox: settings.map.bbox });
  if (!parsed.ok) { res.status(400).json({ ok: false, error: parsed.error }); return; }
  const now = Date.now();
  const results: SensorIngestResult[] = [];
  try {
    for (const d of parsed.detections) results.push(h.world.ingestDetection(d, now));
  } catch (err) {
    h.world.log('system', 'Sensor feed error', (err as Error).message);
    res.status(500).json({ ok: false, error: 'The hub could not take that detection' });
    return;
  }
  flushEffects(h);
  res.json({ ok: true, accepted: results.filter((r) => r.status === 'new' || r.status === 'updated').length, results });
});
function feedOpts(req: express.Request, world: World) {
  const baseUrl = PUBLIC_URL ?? `${req.protocol}://${req.get('host') ?? `localhost:${PORT}`}`;
  return feedOptions(settings, { mode: world.mode, senderName: world.station, baseUrl, nowWall: new Date().toISOString() });
}
app.get('/api/cap.xml', (req, res) => {
  const { world } = reqHarbor(req);
  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/atom+xml; charset=utf-8');
  res.send(capFeed(world.publicZones(), feedOpts(req, world)));
});
app.get('/api/cap/:id.xml', (req, res) => {
  const { world } = reqHarbor(req);
  res.set('Access-Control-Allow-Origin', '*');
  const zone = world.publicZones().find((z) => z.noticeId === req.params.id);
  if (!zone) { res.status(404).type('text/plain').send('No active published notice with that id'); return; }
  res.type('application/cap+xml; charset=utf-8');
  res.send(capAlert(zone, feedOpts(req, world)));
});
app.get('/api/zones.geojson', (req, res) => {
  const { world } = reqHarbor(req);
  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/geo+json');
  res.send(JSON.stringify(zonesGeoJson(world.publicZones(), { mode: world.mode, polygonDecimals: settings.feeds.polygonDecimals })));
});
app.get('/api/conditions.json', (req, res) => res.json({ conditions: reqHarbor(req).world.conditionsView(), status: conditions.status() }));
app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') { res.status(400).json({ ok: false, error: 'The body is not valid JSON' }); return; }
  if (err.type === 'entity.too.large') { res.status(413).json({ ok: false, error: 'The body is over 256 kB; send fewer detections per request' }); return; }
  next(err);
});

const httpServer = http.createServer(app);
const servers: (http.Server | https.Server)[] = [httpServer];
if (hasCerts) servers.push(https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, app));

const io = new Server({ serveClient: false, cors: { origin: true }, pingInterval: 5000, pingTimeout: 8000 });
for (const s of servers) io.attach(s);

const roomOf = (h: HarborRoom, name: string) => (h.code === MAIN ? name : `${h.code}:${name}`);
const pushKey = (h: HarborRoom, vesselId: string) => (h.code === MAIN ? vesselId : `${h.code}:${vesselId}`);
const roomSize = (name: string) => io.sockets.adapter.rooms.get(name)?.size ?? 0;

function emitForecasts(h: HarborRoom, force = false): void {
  const views = h.world.forecastViews();
  const key = views.map((v) => `${v.contactId}:${v.version}`).join('|');
  if (!force && key === h.forecastKey) return;
  h.forecastKey = key;
  io.to(roomOf(h, 'command')).emit('forecasts', views);
}

function emitCommand(h: HarborRoom): void {
  if (!roomSize(roomOf(h, 'command'))) return;
  emitForecasts(h);
  io.to(roomOf(h, 'command')).emit('snapshot', h.world.commandSnapshot({ aisOnTime, joinUrls: urls(h.code) }));
}

function emitCaptains(h: HarborRoom): void {
  for (const vesselId of h.world.captains.keys()) {
    const room = roomOf(h, `v:${vesselId}`);
    if (roomSize(room)) io.to(room).emit('snapshot', h.world.captainSnapshot(vesselId));
  }
}

function flushEffects(h: HarborRoom): void {
  const world = h.world;
  const fx = world.drainEffects();
  if (h.code === MAIN) {
    if (fx.audit.length) audit.append(fx.audit);
    for (const id of fx.undone) audit.markUndone(id);
  }
  for (const p of fx.pushes) {
    const key = pushKey(h, p.vesselId);
    if (!push.hasSubscription(key)) continue;
    void push.send(key, { title: p.title, body: p.body, tag: p.tag, url: withHarbor(p.url, h.code), priority: p.priority, requireInteraction: p.priority === 'P1' }).then((ok) => {
      if (ok) world.log('machine', 'Push sent', `${p.priority} to ${world.craft.find((c) => c.id === p.vesselId)?.name ?? p.vesselId}`);
      world.setSources({ push: { ready: push.ready, detail: push.detail } });
    });
  }
  for (const r of fx.resends) {
    const key = pushKey(h, r.vesselId);
    const viaPush = push.hasSubscription(key)
      ? push.send(key, { title: `ACT NOW: ${r.text.split(': ')[1] ?? r.text}`, body: r.text, tag: r.noticeId, url: withHarbor(`/captain?notice=${r.noticeId}`, h.code), priority: r.priority, requireInteraction: true })
      : Promise.resolve(false);
    void viaPush.then(async (ok) => {
      if (ok) { world.recordResend(r.noticeId, r.vesselId, 'push'); return; }
      const texted = h.code === MAIN ? await sms.send(r.vesselId, r.text) : false;
      world.recordResend(r.noticeId, r.vesselId, texted ? 'sms' : null);
    });
  }
  for (const w of fx.wording) {
    void language.word(w.facts, w.template).then((wording) => { world.applyWording(w.draftId, wording, w.key === 'notice' ? undefined : w.key); emitCommand(h); }).catch(() => undefined);
  }
  world.setSources({ language: language.status() });
}

const COMMAND_EVENTS: (keyof CommandEvents)[] = ['drive', 'spawn', 'removeContact', 'contactParams', 'sensorLoss', 'editDraft', 'publish', 'discardDraft', 'dropZone', 'allClear', 'cardAction', 'clock', 'undo', 'signOrders', 'officer', 'reset', 'markVhfCalled', 'reportSighting', 'confirmSighting', 'extendZone', 'endZone', 'fileDivePlan', 'foundRobot', 'resizeZone', 'relayAdvisory', 'sosDrill'];
const STEERING_EVENTS = new Set<keyof CommandEvents>(['drive', 'contactParams']);

function bindCommand(socket: Socket, h: HarborRoom): void {
  const world = h.world;
  socket.join(roomOf(h, 'command'));
  for (const name of COMMAND_EVENTS) {
    socket.on(name, (payload: unknown, ack?: (r: unknown) => void) => {
      h.lastSeen = Date.now();
      try {
        world.handle(name, payload as never);
        flushEffects(h);
        emitCommand(h);
        if (!STEERING_EVENTS.has(name)) emitCaptains(h);
        ack?.({ ok: true });
      } catch (err) {
        world.log('system', 'Command error', `${name}: ${(err as Error).message}`);
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
  }
  socket.emit('forecasts', world.forecastViews());
  socket.emit('snapshot', world.commandSnapshot({ aisOnTime, joinUrls: urls(h.code) }));
}

function bindCaptain(socket: Socket, h: HarborRoom): void {
  const world = h.world;
  const vesselOf = (payload: { vesselId?: string } | undefined) => {
    h.lastSeen = Date.now();
    const claimed = typeof payload?.vesselId === 'string' && world.captains.has(payload.vesselId) ? payload.vesselId : undefined;
    return (socket.data.vesselId as string | undefined) ?? claimed;
  };
  socket.on('join', (payload: CaptainEvents['join'], ack?: (r: unknown) => void) => {
    h.lastSeen = Date.now();
    const assigned = world.captainJoin(payload?.vesselId);
    if (!assigned) { ack?.({ ok: false, error: 'No vessel available' }); return; }
    const previous = socket.data.vesselId as string | undefined;
    if (previous && previous !== assigned.vesselId) {
      socket.leave(roomOf(h, `v:${previous}`));
      if (!roomSize(roomOf(h, `v:${previous}`))) world.captainLeft(previous);
    }
    socket.data.vesselId = assigned.vesselId;
    socket.join(roomOf(h, `v:${assigned.vesselId}`));
    ack?.({ ok: true, ...assigned, pushKey: push.publicKey });
    socket.emit('snapshot', world.captainSnapshot(assigned.vesselId));
    flushEffects(h);
    emitCommand(h);
  });
  const on = (kind: 'delivered' | 'seen' | 'gotIt') => socket.on(kind, (payload: CaptainEvents['gotIt'], ack?: (r: unknown) => void) => {
    const vesselId = vesselOf(payload);
    if (!vesselId || typeof payload?.noticeId !== 'string') return;
    world.captainEvent(vesselId, kind, payload.noticeId);
    flushEffects(h);
    emitCommand(h);
    socket.emit('snapshot', world.captainSnapshot(vesselId));
    ack?.({ ok: true });
  });
  on('delivered');
  on('seen');
  on('gotIt');
  socket.on('reportSighting', (payload: CaptainEvents['reportSighting'], ack?: (r: unknown) => void) => {
    const vesselId = vesselOf(payload);
    const species = ['whale', 'dolphin', 'sea lion', 'debris', 'hazard'].includes(String(payload?.species)) ? payload.species : null;
    const lonlat = Array.isArray(payload?.lonlat) && payload.lonlat.length === 2 && payload.lonlat.every((n) => Number.isFinite(n)) ? payload.lonlat : null;
    if (!vesselId || !species || !lonlat) { ack?.({ ok: false }); return; }
    const name = world.craft.find((c) => c.id === vesselId)?.name ?? vesselId;
    world.reportSighting({ species, lonlat, note: typeof payload.note === 'string' ? payload.note : '' }, 'phone', name);
    flushEffects(h);
    emitCommand(h);
    ack?.({ ok: true });
  });
  socket.on('sos', (payload: CaptainEvents['sos'], ack?: (r: unknown) => void) => {
    const vesselId = vesselOf(payload);
    const action = payload?.action === 'send' || payload?.action === 'cancel' || payload?.action === 'recovered' ? payload.action : null;
    if (!vesselId || !action) { ack?.({ ok: false }); return; }
    world.captainSos(vesselId, action);
    flushEffects(h);
    emitCommand(h);
    emitCaptains(h);
    ack?.({ ok: true });
  });
  socket.on('pushSubscription', (payload: CaptainEvents['pushSubscription']) => {
    const vesselId = vesselOf(payload);
    if (!vesselId || !payload?.subscription) return;
    push.subscribe(pushKey(h, vesselId), payload.subscription as never);
    world.log(`captain:${vesselId}`, 'Push enabled', `${world.craft.find((c) => c.id === vesselId)?.name ?? vesselId} turned on notifications`);
  });
  socket.on('disconnect', () => {
    const vesselId = socket.data.vesselId as string | undefined;
    if (!vesselId) return;
    if (!roomSize(roomOf(h, `v:${vesselId}`))) world.captainLeft(vesselId);
  });
}

function emitPilots(h: HarborRoom): void {
  const room = roomOf(h, 'pilot');
  if (!roomSize(room)) return;
  io.to(room).emit('pilot', h.world.pilotSnapshot());
}

function bindPilot(socket: Socket, h: HarborRoom): void {
  const world = h.world;
  socket.join(roomOf(h, 'pilot'));
  for (const name of PILOT_REQUESTS) {
    socket.on(name, (payload: unknown, ack?: (r: unknown) => void) => {
      h.lastSeen = Date.now();
      const decision = pilotDecision(name, payload, { mode: world.mode, drivenId: world.drivenContact()?.id ?? null, bbox: settings.map.bbox });
      if (!decision.ok) { ack?.({ ok: false, error: decision.error }); return; }
      try {
        if (decision.action === 'drive') {
          const now = Date.now();
          if (now - ((socket.data.lastSteerMs as number | undefined) ?? 0) >= settings.pilot.steerMinIntervalMs) {
            socket.data.lastSteerMs = now;
            world.drive(decision.contactId, decision.lonlat);
          }
          ack?.({ ok: true });
          return;
        }
        if (decision.action === 'spawn') {
          const c = world.spawn({ preset: 'driven' });
          if (c) world.log('Drive page', 'Judge took the helm', `${c.spec.label} launched outside Angels Gate from the drive page. Simulated.`);
        }
        if (decision.action === 'remove') world.removeContact(decision.contactId, 'Drive page');
        flushEffects(h);
        emitCommand(h);
        emitCaptains(h);
        emitPilots(h);
        ack?.({ ok: true });
      } catch (err) {
        world.log('system', 'Drive page error', `${name}: ${(err as Error).message}`);
        ack?.({ ok: false, error: 'The hub could not do that' });
      }
    });
  }
  socket.emit('pilot', world.pilotSnapshot());
}

io.on('connection', (socket) => {
  const role = socket.handshake.auth?.role;
  const h = harborFor(socket.handshake.auth?.harbor, role === 'command' || role === 'captain' || role === 'pilot');
  h.sockets++;
  h.lastSeen = Date.now();
  socket.data.harbor = h.code;
  socket.emit('harbor', { code: h.code === MAIN ? null : h.code, private: PRIVATE });
  socket.on('disconnect', () => { h.sockets = Math.max(0, h.sockets - 1); h.lastSeen = Date.now(); });
  if (role === 'command') bindCommand(socket, h);
  else if (role === 'pilot') bindPilot(socket, h);
  else bindCaptain(socket, h);
});

let lastTickError = '';
function guarded(name: string, fn: () => void): () => void {
  return () => {
    try {
      fn();
    } catch (err) {
      const message = `${name}: ${(err as Error).message}`;
      if (message !== lastTickError) { lastTickError = message; console.error(`Hub kept running after an error in ${message}`); eachWorld((w) => w.log('system', 'Hub error', message)); }
    }
  };
}
setInterval(guarded('tick', () => {
  const now = Date.now();
  for (const h of harbors.values()) {
    const dt = now - h.last;
    h.last = now;
    h.world.tick(dt, now);
    flushEffects(h);
    emitCommand(h);
    if (++h.tickCount % 2 === 0) emitCaptains(h);
    if (h.tickCount % settings.pilot.snapshotEveryTicks === 0) emitPilots(h);
  }
}), settings.sim.tickMs);
if (PRIVATE) setInterval(() => evictIdle(false), settings.hosting.sweepSeconds * 1000);
setInterval(refreshOnTime, 5000);
const trafficIntel = createTrafficIntel();
setInterval(guarded('traffic', () => {
  shared.intel = trafficIntel.score(aisVessels, shared.sources.ais?.mode === 'live');
  shared.traffic = trafficIntel.facts();
  eachWorld((w) => { w.vesselIntel = shared.intel as World['vesselIntel']; w.modelFacts = { ...w.modelFacts, traffic: shared.traffic as never }; });
}), 5000);
setInterval(() => void refreshNoaa(), 10 * 60_000);
void refreshNoaa();
async function refreshConditions(): Promise<void> {
  try {
    await conditions.refreshDue();
    const view = conditions.view();
    eachWorld((w) => w.setConditions(view));
  } catch (err) {
    eachWorld((w) => w.log('system', 'Conditions error', (err as Error).message));
  }
}
setInterval(() => void refreshConditions(), settings.conditions.checkSeconds * 1000);
void refreshConditions();
setTimeout(refreshOnTime, 2500);

async function attachFrontend(): Promise<void> {
  if (DEV) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
    app.use(vite.middlewares);
    return;
  }
  const dist = path.resolve(process.env.GIVEWAY_DIST || 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^\/(?!api|socket\.io)(?:[^.]*)$/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await attachFrontend();
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log(`GIVE WAY hub on http://localhost:${PORT}${ips.length ? `  (LAN ${ips.map((ip) => `http://${ip}:${PORT}`).join(', ')})` : ''}`);
  if (hasCerts) console.log(`HTTPS on port ${HTTPS_PORT} for phones that need push and offline install`);
  console.log(`AIS mode ${AIS_MODE}; language: ${language.status().detail}${PRIVATE ? `; private harbors on, up to ${settings.hosting.maxHarbors}` : ''}`);
});
if (servers[1]) servers[1].listen(HTTPS_PORT, '0.0.0.0');

function shutdown(): void {
  feed.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
