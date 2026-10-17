import { test, expect, type Browser, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import type { CommandSnapshot, ForecastView } from '../src/shared/protocol';

const SHOTS = 'e2e/screenshots';
const BASE = 'http://localhost:5199';

let socket: Socket;
let snap: CommandSnapshot | null = null;
let forecasts: ForecastView[] = [];

test.beforeAll(async () => {
  socket = io(BASE, { auth: { role: 'command' } });
  socket.on('snapshot', (s: CommandSnapshot) => { snap = s; });
  socket.on('forecasts', (f: ForecastView[]) => { forecasts = f; });
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

async function phone(browser: Browser, vessel: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
  await page.goto(`${BASE}/captain?v=${vessel}`);
  await page.getByTestId('join').click();
  await expect(page.getByTestId('captain')).toBeVisible();
  return page;
}

async function presenter(desk: Page, action: (desk: Page) => Promise<void>): Promise<void> {
  await desk.keyboard.press('p');
  await expect(desk.getByTestId('presenter-panel')).toBeVisible();
  await action(desk);
  await desk.keyboard.press('p');
}

test('night: the forecast learns, the judge phone gets P1, Pilot Boat 2 escalates, all clear', async ({ browser }) => {
  const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await desk.goto(`${BASE}/`);
  await expect(desk.getByTestId('headline')).toBeVisible();
  await presenter(desk, async (d) => {
    await d.getByTestId('reset-night').click();
    await d.getByTestId('time-scale').getByText('20x').click();
  });
  const judge = await phone(browser, 'launch1');
  const teammate = await phone(browser, 'water1');

  await test.step('1. An unknown drone at Angels Gate; the forecast narrows onto the Fuel Pier', async () => {
    await presenter(desk, async (d) => { await d.getByTestId('incident-A').click(); });
    await expect(desk.getByTestId('steps')).toBeVisible();
    await expect(desk.getByTestId('headline')).toContainText('heading to the Fuel Pier', { timeout: 60_000 });
    await expect(desk.getByTestId('step-predict')).toContainText('Fuel Pier');
    await expect.poll(() => forecasts.some((f) => f.likely.length > 0 && f.careful.length > 0 && f.ticks.length > 0), { timeout: 20_000 }).toBe(true);
    await desk.screenshot({ path: `${SHOTS}/1-night-forecast.png` });
  });

  await test.step('2. One decision card with one row per boat; publish inside the P1 window', async () => {
    await expect(desk.getByTestId('card-title')).toContainText('Publish this notice', { timeout: 30_000 });
    await expect(desk.getByTestId('boat-table')).toBeVisible();
    if (await desk.getByTestId('auto-publish').isVisible()) await desk.getByTestId('card-holdAuto').click();
    await expect(desk.getByTestId('auto-publish')).toHaveCount(0);
    await desk.getByTestId('open-dossier').click();
    await expect(desk.getByTestId('dossier-sensor')).toContainText('Heat signature');
    await expect(desk.getByTestId('dossier-calc')).toBeVisible();
    await desk.screenshot({ path: `${SHOTS}/2-night-dossier.png` });
    await desk.getByTestId('dossier-close').click();
    await expect.poll(() => (snap?.clock.simMin ?? 0) - 120, { timeout: 60_000 }).toBeGreaterThanOrEqual(7.5);
    await desk.screenshot({ path: `${SHOTS}/2-night-decision.png` });
    await desk.getByTestId('card-publish').click();
  });

  await test.step('3. The judge phone gets the P1 takeover with an action and a countdown; Got it', async () => {
    await expect(judge.getByTestId('takeover')).toBeVisible({ timeout: 60_000 });
    await expect(judge.getByTestId('takeover-instruction')).toHaveText(/^(HOLD POSITION|SLOW TO \d+ KNOTS|STEP ASIDE [A-Z]+ \d+ m|ALTER COURSE [A-Z]+ \d+ m)$/);
    await expect(judge.getByTestId('countdown').first()).toBeVisible();
    await judge.screenshot({ path: `${SHOTS}/3-judge-phone-p1.png` });
    await judge.getByTestId('got-it').first().click();
    await expect(desk.getByTestId('delivery-launch1')).toContainText(/Acknowledged|Complying/, { timeout: 15_000 });
    await expect(teammate.getByTestId('takeover')).toHaveCount(0);
    await teammate.screenshot({ path: `${SHOTS}/3-teammate-phone.png` });
    await desk.screenshot({ path: `${SHOTS}/3-command-acknowledged.png` });
  });

  await test.step('4. Pilot Boat 2 ignores it and escalates to the VHF card', async () => {
    await expect(desk.getByTestId('card-title')).toContainText('Pilot Boat 2', { timeout: 90_000 });
    await expect(desk.getByTestId('headline')).toContainText('Call it on VHF');
    await desk.screenshot({ path: `${SHOTS}/4-not-responding.png` });
    await desk.getByTestId('card-called').click();
  });

  await test.step('5. All clear reaches every phone', async () => {
    await desk.getByTestId('all-clear').first().click();
    await expect(judge.getByTestId('all-clear-banner')).toBeVisible({ timeout: 15_000 });
    await judge.screenshot({ path: `${SHOTS}/5-all-clear-phone.png` });
    await expect(desk.getByTestId('incident-list')).toBeVisible({ timeout: 15_000 });
    await desk.getByTestId('incident-list').locator('button').first().click();
    await expect(desk.getByTestId('incident-report')).toContainText('Published', { timeout: 10_000 });
    await expect(desk.getByTestId('incident-lead')).toBeVisible();
    await desk.screenshot({ path: `${SHOTS}/5-after-action-report.png` });
    await desk.getByTestId('incident-close').click();
  });

  await test.step('6. Run 1,000 nights shows the bar, calibration and coverage', async () => {
    await presenter(desk, async (d) => { await d.getByTestId('run-nights').click(); });
    await expect(desk.getByTestId('nights-result')).toBeVisible({ timeout: 30_000 });
    await expect(desk.getByTestId('calibration-result')).toBeVisible({ timeout: 90_000 });
    await desk.screenshot({ path: `${SHOTS}/6-run-1000-nights.png` });
  });
  await desk.context().close();
  await judge.context().close();
  await teammate.context().close();
});

test('Tuesday: dive plan, a whale from a phone, on-time impact, glider search, daily report', async ({ browser }) => {
  const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  await desk.goto(`${BASE}/`);
  await presenter(desk, async (d) => {
    await d.getByTestId('reset-tuesday').click();
    await d.getByTestId('time-scale').getByText('20x').click();
  });
  const captain = await phone(browser, 'launch1');

  await test.step('1. Tuesday opens busy', async () => {
    await expect(desk.getByTestId('headline')).toContainText('Tuesday');
    const today = desk.getByTestId('today');
    await expect(today).toContainText('Hull dive, Pier 400');
    await expect(today).toContainText('Dredge, Main Channel');
    await expect(today).toContainText('Blue whale, approach lanes');
    await desk.screenshot({ path: `${SHOTS}/7-tuesday-today.png` });
  });

  await test.step('2. A dive plan is filed from the desk', async () => {
    await desk.getByTestId('dive-place').click();
    const spot = await screenPoint(desk, [-118.2765, 33.7395]);
    await desk.mouse.click(spot.x, spot.y);
    await desk.getByTestId('dive-file').click();
    await expect(desk.getByTestId('today')).toContainText('Harbor Divers LLC');
  });

  await test.step('3. A whale reported from a phone, confirmed and published by the desk', async () => {
    await captain.getByTestId('report-sighting').click();
    await captain.getByText('Whale', { exact: true }).first().click();
    await captain.getByTestId('where-here').click();
    await captain.getByTestId('send-sighting').click();
    await expect(captain.getByTestId('sighting-sent')).toBeVisible({ timeout: 10_000 });
    await captain.screenshot({ path: `${SHOTS}/8-phone-sighting-sent.png` });
    await expect(desk.getByTestId('card-title')).toContainText('reported by Harbor Launch 7', { timeout: 10_000 });
    await desk.getByTestId('card-confirmSighting').click();
    await expect(desk.getByTestId('card-title')).toContainText('Whale slow zone ready');
    await desk.getByTestId('card-publish').click();
    await expect(desk.getByTestId('today')).toContainText('Whale, reported by Harbor Launch 7');
  });

  await test.step('4. The on-time board shows what the zones cost', async () => {
    await desk.getByTestId('desk-ontime').click();
    await expect(desk.getByTestId('ontime-board')).toBeVisible();
    await desk.screenshot({ path: `${SHOTS}/9-tuesday-on-time.png` });
  });

  await test.step('5. The lost glider: drift search area, published, then found', async () => {
    await presenter(desk, async (d) => { await d.getByTestId('spawn-glider').click(); });
    await expect(desk.getByTestId('card-title')).toContainText('Lost, not hostile', { timeout: 20_000 });
    await desk.getByTestId('card-publishZone').click();
    await desk.getByTestId('desk-today').click();
    await expect(desk.getByTestId('today')).toContainText('Search area');
    await desk.screenshot({ path: `${SHOTS}/10-glider-search.png` });
    await desk.getByTestId('card-found').click();
    await expect(desk.getByTestId('today')).not.toContainText('Search area', { timeout: 10_000 });
  });

  await test.step('6a. The log shows where things happened and the public board lists every notice', async () => {
    await desk.getByTestId('desk-log').click();
    await desk.locator('[data-testid^="log-place-"]').filter({ hasText: 'Whale slow zone active' }).first().click();
    await expect(desk.getByTestId('zone-inspector')).toContainText('Blue whale', { timeout: 10_000 });
    await desk.screenshot({ path: `${SHOTS}/12-log-to-zone.png` });
    await desk.getByTestId('zone-close').click();
    const board = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await board.goto(`${BASE}/board`);
    await expect(board.getByTestId('board-notice').first()).toBeVisible({ timeout: 15_000 });
    await expect(board.getByTestId('board')).not.toContainText('drone');
    await board.screenshot({ path: `${SHOTS}/13-public-board.png` });
    await board.context().close();
  });

  await test.step('6. A zone is dragged wider and the models explain themselves', async () => {
    await desk.getByTestId('desk-today').click();
    const handles = desk.locator('.zone-handle');
    let box: { x: number; y: number; width: number; height: number } | null = null;
    for (let i = 0; i < await handles.count(); i++) {
      const b = await handles.nth(i).boundingBox();
      if (b && b.x > 40 && b.y > 200 && b.x < 900 && b.y < 480) { box = b; break; }
    }
    if (!box) throw new Error('no zone handle on screen');
    await desk.mouse.move(box.x + 6, box.y + box.height / 2);
    await desk.mouse.down();
    await desk.mouse.move(box.x + 46, box.y + box.height / 2, { steps: 6 });
    await desk.mouse.up();
    await expect.poll(() => snap?.audit.some((a) => a.action === 'Zone resized' || a.detail.startsWith('Keep-clear radius set')) ?? false, { timeout: 10_000 }).toBe(true);
    await desk.getByTestId('open-models').click();
    await expect(desk.getByTestId('models-panel')).toContainText('TELL');
    await desk.screenshot({ path: `${SHOTS}/14-models.png` });
    await desk.getByTestId('models-close').click();
  });

  await test.step('7. The daily report exports', async () => {
    await desk.getByTestId('desk-report').click();
    await expect(desk.getByTestId('daily-report')).toContainText('zones issued');
    const [download] = await Promise.all([desk.waitForEvent('download'), desk.getByTestId('export-report').click()]);
    expect(download.suggestedFilename()).toBe('giveway-daily-report.csv');
    await desk.screenshot({ path: `${SHOTS}/11-daily-report.png` });
  });
  await desk.context().close();
  await captain.context().close();
});
