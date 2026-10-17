import { chromium, devices } from '@playwright/test';
import { io } from 'socket.io-client';

const base = process.env.BASE || 'http://localhost:5170';
const out = process.argv[2] || 'e2e/screenshots';
const vessel = process.argv[3] || 'launch1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const phoneCtx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
const phone = await phoneCtx.newPage();
const errors = [];
phone.on('pageerror', (e) => errors.push('phone ' + e));
const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
desk.on('pageerror', (e) => errors.push('desk ' + e));

const cmd = io(base, { auth: { role: 'command' } });
let last = null;
cmd.on('snapshot', (s) => { last = s; });
const send = (n, p) => new Promise((ok) => cmd.timeout(3000).emit(n, p, ok));
while (!last) await sleep(100);

await send('reset', { mode: 'night' });
await send('clock', { timeScale: 30, paused: false });
await phone.goto(`${base}/captain?v=${vessel}`);
await phone.getByTestId('join').click();
await sleep(1500);
await desk.goto(`${base}/`);
await send('spawn', { preset: 'driven' });
await sleep(500);
await send('drive', { contactId: last.contacts[0].id, lonlat: [-118.2190, 33.7520] });
for (let i = 0; i < 200; i++) {
  await sleep(200);
  const fuel = last.contacts[0]?.odds.find((o) => o.id === 'fuel')?.p ?? 0;
  if (fuel >= 0.7 && last.drafts.length) break;
}
await send('clock', { paused: true });
await sleep(800);
await desk.screenshot({ path: `${out}/command-draft.png` });
await send('publish', { draftId: last.drafts[0].id });
await send('clock', { paused: false, timeScale: 20 });
let p1 = false;
for (let i = 0; i < 150; i++) {
  await sleep(200);
  if (await phone.getByTestId('takeover').count()) { p1 = true; break; }
}
await send('clock', { paused: true });
await sleep(600);
await phone.screenshot({ path: `${out}/captain-after-publish.png` });
await desk.screenshot({ path: `${out}/command-published.png` });
console.log('P1 takeover on phone:', p1);
if (p1) {
  await phone.getByTestId('got-it').first().click();
  await sleep(800);
  await phone.screenshot({ path: `${out}/captain-got-it.png` });
  await desk.screenshot({ path: `${out}/command-acknowledged.png` });
}
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
process.exit(0);
