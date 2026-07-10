#!/usr/bin/env node
// Télécharge les images à la une existantes et les optimise en webp responsive
// dans public/covers/{id}-{w}.webp + un LQIP (placeholder flou) dans data/images.json.
// Idempotent / reprenable : saute les images déjà générées.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'covers');
const WIDTHS = [400, 800, 1280];
const CONCURRENCY = 6;

const exists = (p) => access(p).then(() => true).catch(() => false);

async function fetchOne(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'cda-migration/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Essaie plusieurs URLs candidates (le "full" original est souvent supprimé du
// disque WP alors que les dérivés dimensionnés existent encore).
async function download(candidates, tries = 3) {
  const list = [...new Set(candidates.filter(Boolean))];
  let lastErr;
  for (let i = 0; i < tries; i++) {
    for (const url of list) {
      try { return await fetchOne(url); }
      catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, (i + 1) * 1000));
  }
  throw lastErr || new Error('no candidate');
}

async function processOne(post, imagesMap) {
  // Ordre de préférence : la taille dimensionnée (existe presque toujours) puis
  // l'original "full" (souvent supprimé). On tente aussi de dériver l'URL 1024.
  const url = post.image?.url;
  const full = post.image?.full;
  const derived1024 = full ? full.replace(/\.(jpe?g|png|webp)$/i, '-1024x683.$1') : null;
  const candidates = [url, derived1024, full];
  if (!candidates.some(Boolean)) return { id: post.id, skipped: 'no-source' };

  // Récupère toujours la géométrie + lqip (léger) ; ne re-télécharge que si fichiers absents.
  const haveAll = (await Promise.all(WIDTHS.map((w) => exists(join(OUT, `${post.id}-${w}.webp`))))).every(Boolean);

  let buf;
  try {
    if (!haveAll || !imagesMap[post.id]?.lqip) buf = await download(candidates);
  } catch (e) {
    return { id: post.id, error: `download ${e.message}` };
  }

  let meta;
  if (buf) {
    const img = sharp(buf, { failOn: 'none' });
    meta = await img.metadata();
    for (const w of WIDTHS) {
      const dest = join(OUT, `${post.id}-${w}.webp`);
      if (await exists(dest)) continue;
      await sharp(buf, { failOn: 'none' })
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 74, effort: 4 })
        .toFile(dest);
    }
  }

  // LQIP : minuscule webp flou en data URI
  let lqip = imagesMap[post.id]?.lqip;
  if (buf && !lqip) {
    const tiny = await sharp(buf, { failOn: 'none' })
      .resize({ width: 24 })
      .blur(1.2)
      .webp({ quality: 40 })
      .toBuffer();
    lqip = `data:image/webp;base64,${tiny.toString('base64')}`;
  }

  const width = meta?.width || post.image?.width || 1200;
  const height = meta?.height || post.image?.height || 800;
  return {
    id: post.id,
    data: {
      base: `/covers/${post.id}`,
      widths: WIDTHS,
      w: width,
      h: height,
      ratio: +(width / height).toFixed(4),
      lqip: lqip || null,
      alt: post.image?.alt || '',
    },
  };
}

async function pool(items, worker, size) {
  const results = [];
  let idx = 0;
  const runners = Array.from({ length: size }, async () => {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await worker(items[my], my);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const withImg = posts.filter((p) => p.image?.url || p.image?.full);

  let imagesMap = {};
  try { imagesMap = JSON.parse(await readFile(join(ROOT, 'data', 'images.json'), 'utf8')); } catch {}

  console.log(`Traitement de ${withImg.length} images (concurrence ${CONCURRENCY})…`);
  let done = 0, errors = 0;
  const res = await pool(withImg, async (post) => {
    const r = await processOne(post, imagesMap);
    done++;
    if (r.error) { errors++; console.warn(`  ✗ ${post.id} ${r.error}`); }
    if (done % 50 === 0) console.log(`  … ${done}/${withImg.length}`);
    return r;
  }, CONCURRENCY);

  for (const r of res) if (r?.data) imagesMap[r.id] = r.data;
  await writeFile(join(ROOT, 'data', 'images.json'), JSON.stringify(imagesMap, null, 0));
  console.log(`\n✓ ${Object.keys(imagesMap).length} images prêtes dans public/covers/ — ${errors} erreurs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
