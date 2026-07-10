import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8790';
const url = BASE + '/bien-choisir-son-pack-office-windows-comparer-les-versions-pro-plus-famille-et-famille-pro.asp';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
// scroll to the content grid (TOC + first blocks)
for (const [name, y] of [['art-body1', 1500], ['art-body2', 2600], ['art-body3', 3700], ['art-faq', 6200]]) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `scratch-shots/${name}.png` });
}
await browser.close();
console.log('done');
