import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:5170';
const SECONDS = Number(process.env.SECONDS || 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const socket = io(BASE, { auth: { role: 'command' } });
await new Promise((r) => socket.on('connect', r));
socket.emit('reset', { mode: 'night' });
await sleep(400);
socket.emit('spawn', { preset: 'scenario', scenarioKey: 'A' });

const browser = await chromium.launch({ headless: process.env.HEADED ? false : true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/`);
await page.waitForFunction(() => window.givewayMotion && window.givewayMotion.frames > 30, null, { timeout: 30000 });
await sleep(2000);
const samples = await page.evaluate(async (seconds) => {
  const out = [];
  const end = performance.now() + seconds * 1000;
  return await new Promise((resolve) => {
    const step = () => {
      const m = window.givewayMotion;
      out.push({ t: performance.now(), c: m.contact ? [...m.contact] : null, setMs: m.lastMs });
      if (performance.now() < end) requestAnimationFrame(step); else resolve(out);
    };
    requestAnimationFrame(step);
  });
}, SECONDS);
await browser.close();
socket.close();

const dts = [];
const steps = [];
for (let k = 1; k < samples.length; k++) {
  dts.push(samples[k].t - samples[k - 1].t);
  const a = samples[k - 1].c, b = samples[k].c;
  if (a && b) steps.push(Math.hypot((b[0] - a[0]) * 92700, (b[1] - a[1]) * 111000));
}
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const medStep = median(steps);
const zero = steps.filter((d) => d < 1e-6).length;
const big = steps.filter((d) => d > 3 * medStep).length;
console.log(JSON.stringify({
  frames: samples.length, seconds: SECONDS,
  medianFrameMs: +median(dts).toFixed(2), p95FrameMs: +[...dts].sort((x, y) => x - y)[Math.floor(dts.length * 0.95)].toFixed(2),
  medianStepM: +medStep.toFixed(3), zeroStepFrames: zero, framesOver3xMedian: big, maxStepM: +Math.max(...steps).toFixed(3),
  medianSetDataMs: +median(samples.map((s) => s.setMs)).toFixed(2),
}));
