import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8791';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
for (const [name, y] of [['scroll-750', 750], ['scroll-1500', 1500], ['scroll-2300', 2300]]) {
  await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `scratch-shots/${name}.png` });
  console.log('shot', name);
}
// diagnostic : combien de data-reveal restent cachés après scroll complet
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1200);
const hidden = await page.evaluate(() => document.querySelectorAll('[data-reveal]:not(.is-in)').length);
const total = await page.evaluate(() => document.querySelectorAll('[data-reveal]').length);
console.log(`data-reveal cachés après scroll: ${hidden}/${total}`);
await browser.close();
