import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const BASE = 'https://cuilleredargent.pages.dev';
const shots = [
  ['/', 'live-home-desktop', 1440, 900, false, false],
  ['/', 'live-home-full', 1440, 900, false, true],
  ['/', 'live-home-mobile', 390, 844, true, false],
  ['/articles', 'live-archive', 1440, 900, false, false],
];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'], proxy: PROXY ? { server: PROXY } : undefined });
for (const [path, name, w, h, mobile, full] of shots) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `scratch-shots/${name}.png`, fullPage: full });
  console.log('shot', name);
  await ctx.close();
}
await browser.close();
console.log('done');
