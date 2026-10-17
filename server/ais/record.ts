import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import WebSocket from 'ws';
import settings from '../../settings/giveway.settings.json';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';

function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const minutes = Number(argValue('minutes', '45'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.resolve(argValue('out', `data/recordings/ais-${stamp}.jsonl`));
const apiKey = process.env.AISSTREAM_API_KEY;

if (!apiKey) {
  console.error('AISSTREAM_API_KEY is missing from .env. Replay mode still works with an existing recording.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const out = fs.createWriteStream(outFile, { flags: 'a' });
const endAt = Date.now() + minutes * 60_000;
const vessels = new Set<number>();
let messages = 0;
let reconnects = 0;

function connect(): void {
  const ws = new WebSocket(AIS_URL);
  ws.on('open', () => {
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [settings.ais.bbox],
      FilterMessageTypes: settings.ais.messageTypes,
    }));
    console.log(`Recording San Pedro Bay AIS for ${minutes} min to ${path.relative(process.cwd(), outFile)}`);
  });
  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg: { MessageType?: string; MetaData?: { MMSI?: number }; error?: string };
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.error) { console.error(`aisstream says: ${msg.error}`); return; }
    out.write(JSON.stringify({ t: Date.now(), m: msg }) + '\n');
    messages++;
    if (msg.MetaData?.MMSI) vessels.add(msg.MetaData.MMSI);
  });
  ws.on('close', () => {
    if (Date.now() < endAt) {
      reconnects++;
      setTimeout(connect, Math.min(30_000, 2_000 * reconnects));
    }
  });
  ws.on('error', (err) => console.error(`AIS connection problem: ${err.message}`));
  setTimeout(() => ws.close(), Math.max(0, endAt - Date.now()));
}

const progress = setInterval(() => {
  const left = Math.max(0, Math.round((endAt - Date.now()) / 60_000));
  console.log(`${messages} messages from ${vessels.size} vessels, ${left} min left`);
}, 60_000);

setTimeout(() => {
  clearInterval(progress);
  out.end(() => {
    console.log(`Done: ${messages} messages from ${vessels.size} vessels in ${path.relative(process.cwd(), outFile)}`);
    process.exit(0);
  });
}, minutes * 60_000 + 1_500);

connect();
