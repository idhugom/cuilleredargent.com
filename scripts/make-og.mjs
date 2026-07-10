#!/usr/bin/env node
// Génère public/og-default.png (carte de partage par défaut).
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#d7dbe0"/>
      <stop offset=".55" stop-color="#8b919b"/><stop offset=".75" stop-color="#eef0f3"/>
      <stop offset="1" stop-color="#7d838d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#e5502a" stop-opacity="0.35"/><stop offset="1" stop-color="#e5502a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0b0b0e"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(90,150)">
    <ellipse cx="34" cy="34" rx="30" ry="34" fill="url(#chrome)"/>
    <rect x="24" y="60" width="20" height="70" rx="10" fill="url(#chrome)"/>
  </g>
  <text x="90" y="360" font-family="Georgia, serif" font-size="96" font-weight="500" fill="url(#chrome)" letter-spacing="-3">Cuillère d'argent</text>
  <text x="94" y="430" font-family="Georgia, serif" font-size="40" font-style="italic" fill="#c9ccd2">On déniche, on décortique, on raconte.</text>
  <rect x="94" y="470" width="120" height="4" fill="#e5502a"/>
  <text x="94" y="545" font-family="Arial, sans-serif" font-size="26" fill="#9aa0aa" letter-spacing="4">MAGAZINE GÉNÉRALISTE INDÉPENDANT</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(join(ROOT, 'public', 'og-default.png'));
console.log('✓ public/og-default.png généré');
