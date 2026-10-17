import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
page.on('requestfailed', (r) => console.log('failed', r.url(), r.failure()?.errorText));
await page.goto('http://localhost:5170/?theme=day', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
console.log(await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const el = document.querySelector('.chart-map');
  return JSON.stringify({ canvas: c ? [c.width, c.height] : null, holder: el ? [el.clientWidth, el.clientHeight] : null, gl: !!document.createElement('canvas').getContext('webgl2') });
}));
await page.screenshot({ path: process.argv[2] });
await browser.close();
