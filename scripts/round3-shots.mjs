import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:5170';
const OUT = 'design/renders/round3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const socket = io(BASE, { auth: { role: 'command' } });
let snap = null;
socket.on('snapshot', (s) => { snap = s; });
await new Promise((r) => socket.on('connect', r));
const send = (name, payload) => new Promise((r) => socket.emit(name, payload, r));

const browser = await chromium.launch();
const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();

await send('reset', { mode: 'night' });
await send('clock', { timeScale: 20, paused: false });
await phone.goto(`${BASE}/captain?v=launch1`);
await phone.getByTestId('join').click();
await desk.goto(`${BASE}/`);
await sleep(1500);
await send('spawn', { preset: 'scenario', scenarioKey: 'A' });
await sleep(6000);
await desk.screenshot({ path: `${OUT}/1-night-first-seen.png` });
await sleep(14000);
await desk.screenshot({ path: `${OUT}/2-night-learning.png` });
await sleep(8000);
await desk.screenshot({ path: `${OUT}/3-night-confident.png` });
const draft = snap.drafts.find((d) => d.kind === 'security');
if (draft) await send('publish', { draftId: draft.id });
await sleep(4000);
await desk.screenshot({ path: `${OUT}/4-night-published.png` });
await phone.screenshot({ path: `${OUT}/5-phone-judge.png` });
await desk.getByRole('button', { name: 'Day' }).click().catch(() => undefined);
await sleep(2500);
await desk.screenshot({ path: `${OUT}/6-day-theme-published.png` });

await send('reset', { mode: 'tuesday' });
await sleep(3000);
await desk.reload();
await sleep(4000);
await desk.screenshot({ path: `${OUT}/7-tuesday.png` });
await phone.reload();
await sleep(3000);
await phone.screenshot({ path: `${OUT}/8-phone-tuesday.png` });
await browser.close();
socket.close();
console.log('shots in', OUT);
