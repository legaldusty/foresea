import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5170/');
await page.waitForTimeout(3000);
for (const [id, name] of [['run-nights', 'nights'], ['open-orders', 'orders'], ['open-join', 'join']]) {
  await page.getByTestId(id).click();
  await page.waitForTimeout(name === 'nights' ? 2500 : 1200);
  await page.screenshot({ path: `${out}/sheet-${name}.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 890);
  await page.waitForTimeout(300);
}
await page.getByTestId('tool-drive').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/drive.png` });
await browser.close();
