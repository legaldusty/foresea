import { test, expect, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import type { CommandSnapshot } from '../src/shared/protocol';

const SHOTS = 'e2e/screenshots';
const BASE = 'http://localhost:5199';

let socket: Socket;
let snap: CommandSnapshot | null = null;

test.beforeAll(async () => {
  socket = io(BASE, { auth: { role: 'command' } });
  socket.on('snapshot', (s: CommandSnapshot) => { snap = s; });
  await expect.poll(() => snap !== null, { timeout: 15_000 }).toBe(true);
});

test.afterAll(() => { socket.close(); });

async function screenPoint(page: Page, lonlat: [number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate(([lon, lat]) => {
    const map = (window as unknown as { givewayChart: { project: (p: [number, number]) => { x: number; y: number }; getCanvas: () => HTMLCanvasElement } }).givewayChart;
    const p = map.project([lon, lat]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, lonlat);
}

test('the six-step demo runs end to end', async ({ browser }) => {
  const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const judge = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
  const teammate = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();

  await desk.goto(`${BASE}/`);
  await desk.getByTestId('scene').click();
  await desk.getByTestId('reset-tuesday').click();
  await desk.getByTestId('time-scale').getByText('20x').click();

  await judge.goto(`${BASE}/captain?v=ferry1`);
  await judge.getByTestId('join').click();
  await teammate.goto(`${BASE}/captain?v=water1`);
  await teammate.getByTestId('join').click();
  await expect(judge.getByTestId('captain')).toBeVisible();

  await test.step('1. Tuesday: whale zone on the ferry route, published to phones', async () => {
    await expect.poll(() => snap?.vessels.find((v) => v.id === 'ferry1')?.route?.length ?? 0).toBeGreaterThan(4);
    const route = snap!.vessels.find((v) => v.id === 'ferry1')!.route!;
    const spot = route[Math.floor(route.length * 0.4)];
    await desk.getByTestId('tool-whale').click();
    const pt = await screenPoint(desk, spot);
    await desk.mouse.click(pt.x, pt.y);
    await expect(desk.getByTestId('notice-editor')).toBeVisible();
    await desk.getByTestId('publish').click();
    await expect(judge.getByText('SLOW TO 10 KNOTS').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => snap!.deliveries.filter((d) => d.states.acknowledged !== undefined).length, { timeout: 30_000 }).toBeGreaterThan(2);
    await desk.screenshot({ path: `${SHOTS}/1-tuesday-command.png` });
    await judge.screenshot({ path: `${SHOTS}/1-tuesday-judge-phone.png` });
    await desk.getByTestId('all-clear').first().click();
  });

  await test.step('2. Night: unknown contact, TELL calls the Fuel Pier, notice drafted, radius edited, published', async () => {
    await desk.getByTestId('scene').click();
    await desk.getByTestId('reset-night').click();
    await judge.goto(`${BASE}/captain?v=launch1`);
    await judge.getByTestId('join').click();
    await expect(judge.getByTestId('captain')).toBeVisible();
    await desk.getByTestId('add-contact').click();
    await desk.getByTestId('spawn-driven').click();
    const pt = await screenPoint(desk, [-118.2190, 33.7520]);
    await desk.mouse.move(pt.x, pt.y);
    await desk.mouse.move(pt.x + 2, pt.y + 2);
    await expect(desk.getByTestId('tell-top')).toContainText('Fuel Pier', { timeout: 60_000 });
    await expect(desk.getByTestId('publish')).toBeVisible({ timeout: 60_000 });
    await expect(desk.getByTestId('risk-score').first()).toBeVisible();
    await desk.getByTestId('radius-input').fill('400');
    await desk.screenshot({ path: `${SHOTS}/2-night-draft.png` });
    await desk.getByTestId('publish').click();
    await expect(desk.getByTestId('notice-summary')).toBeVisible();
  });

  await test.step('3. Phones get their own priority; Got it updates Command', async () => {
    const urgent = judge.getByTestId('takeover').or(judge.getByTestId('banner'));
    await expect(urgent.first()).toBeVisible({ timeout: 60_000 });
    await judge.screenshot({ path: `${SHOTS}/3-judge-phone-alert.png` });
    await teammate.screenshot({ path: `${SHOTS}/3-teammate-phone.png` });
    await judge.getByTestId('got-it').first().click();
    await expect(desk.getByTestId('delivery-launch1')).toContainText(/Acknowledged|Complying/, { timeout: 5_000 });
    await desk.screenshot({ path: `${SHOTS}/3-command-acknowledged.png` });
  });

  await test.step('4. A boat that ignores it is escalated with a VHF script', async () => {
    await expect(desk.getByTestId('card-title')).toContainText('not responding', { timeout: 90_000 });
    await desk.screenshot({ path: `${SHOTS}/4-not-responding.png` });
  });

  await test.step('5. All clear lifts every zone on every phone', async () => {
    await desk.getByTestId('all-clear').first().click();
    await expect(judge.getByTestId('all-clear-banner')).toBeVisible({ timeout: 10_000 });
    await judge.screenshot({ path: `${SHOTS}/5-all-clear-phone.png` });
  });

  await test.step('6. Run 1,000 nights', async () => {
    await desk.getByTestId('run-nights').click();
    await expect(desk.getByTestId('nights-result')).toBeVisible({ timeout: 60_000 });
    await desk.screenshot({ path: `${SHOTS}/6-run-1000-nights.png` });
  });
});
