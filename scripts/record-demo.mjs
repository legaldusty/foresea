import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:5170';
const OUT = path.resolve('e2e/videos');
const RAW = path.join(OUT, 'raw');
fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const socket = io(BASE, { auth: { role: 'command' } });
let snap = null;
socket.on('snapshot', (s) => { snap = s; });
while (!snap) await sleep(100);

const browser = await chromium.launch();
const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: path.join(RAW, 'desk'), size: { width: 1440, height: 900 } } });
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, recordVideo: { dir: path.join(RAW, 'phone'), size: { width: 390, height: 844 } } });
const desk = await deskCtx.newPage();
const phone = await phoneCtx.newPage();

async function at(page, lonlat) {
  return page.evaluate(([lon, lat]) => {
    const map = window.givewayChart;
    const p = map.project([lon, lat]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, lonlat);
}

await desk.goto(`${BASE}/`);
await phone.goto(`${BASE}/captain?v=ferry1`);
await desk.getByTestId('scene').click();
await desk.getByTestId('reset-tuesday').click();
await desk.getByTestId('time-scale').getByText('20x').click();
await sleep(1500);
await phone.getByTestId('join').click();
await sleep(2500);

const route = snap.vessels.find((v) => v.id === 'ferry1').route;
const spot = route[Math.floor(route.length * 0.4)];
await desk.getByTestId('tool-whale').click();
await sleep(800);
const w = await at(desk, spot);
await desk.mouse.move(w.x, w.y, { steps: 12 });
await desk.mouse.click(w.x, w.y);
await sleep(2500);
await desk.getByTestId('publish').click();
await sleep(6000);
await phone.getByTestId('got-it').first().click().catch(() => undefined);
await sleep(4000);

await desk.getByTestId('all-clear').first().click();
await sleep(2000);
await desk.getByTestId('scene').click();
await desk.getByTestId('reset-night').click();
await sleep(1500);
await phone.locator('.cap-strip .who').click();
await sleep(800);
await phone.getByText('Harbor Launch 7').click();
await sleep(2000);
await desk.getByTestId('add-contact').click();
await sleep(800);
await desk.getByTestId('spawn-driven').click();
await sleep(1500);
const fuel = await at(desk, [-118.2190, 33.7520]);
const start = await at(desk, [-118.2490, 33.7050]);
await desk.mouse.move(start.x, start.y);
await desk.mouse.down();
await desk.mouse.move(fuel.x, fuel.y, { steps: 40 });
await desk.mouse.up();
for (let i = 0; i < 120; i++) {
  await sleep(250);
  const c = snap.contacts[0];
  const p = c?.odds.find((o) => o.id === 'fuel')?.p ?? 0;
  if (p >= 0.7 && snap.drafts.length) break;
}
await sleep(1500);
await desk.getByTestId('radius-input').fill('400');
await sleep(1500);
await desk.getByTestId('publish').click();
for (let i = 0; i < 160; i++) {
  await sleep(250);
  if (await phone.getByTestId('takeover').count()) break;
}
await sleep(4000);
await phone.getByTestId('got-it').first().click().catch(() => undefined);
await sleep(4000);
for (let i = 0; i < 240; i++) {
  await sleep(250);
  if (snap.card?.kind === 'notResponding') break;
}
await sleep(5000);
await desk.getByTestId('card-called').click().catch(() => undefined);
await sleep(2000);
await desk.getByTestId('all-clear').first().click();
await sleep(5000);
await desk.getByTestId('run-nights').click();
await sleep(7000);

const deskVideo = await desk.video().path();
const phoneVideo = await phone.video().path();
await deskCtx.close();
await phoneCtx.close();
await browser.close();
socket.close();

const out = path.join(OUT, 'giveway-demo.mp4');
const r = spawnSync('ffmpeg', ['-y', '-i', deskVideo, '-i', phoneVideo, '-filter_complex',
  '[1:v]scale=-2:900,pad=iw+24:900:24:0:color=0x0A1621[p];[0:v][p]hstack=inputs=2:shortest=1,format=yuv420p[v]',
  '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', out], { stdio: 'inherit' });
if (r.status !== 0) { console.error('ffmpeg failed'); process.exit(1); }
console.log(`Backup video: ${path.relative(process.cwd(), out)}`);
