import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8790';
const shots = [
  ['/', 'home-desktop', 1440, 900, false],
  ['/', 'home-mobile', 390, 844, true],
  ['/bien-choisir-son-pack-office-windows-comparer-les-versions-pro-plus-famille-et-famille-pro.asp', 'article-desktop', 1440, 900, false],
  ['/articles', 'archive-desktop', 1440, 900, false],
  ['/recherche', 'search-desktop', 1440, 900, false],
];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
for (const [path, name, w, h, mobile] of shots) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1400); // laisser jouer les révélations
  await page.screenshot({ path: `scratch-shots/${name}.png`, fullPage: false });
  // pleine page pour home et article
  if (name === 'home-desktop' || name === 'article-desktop') {
    await page.screenshot({ path: `scratch-shots/${name}-full.png`, fullPage: true });
  }
  console.log('shot', name);
  await ctx.close();
}
await browser.close();
console.log('done');
