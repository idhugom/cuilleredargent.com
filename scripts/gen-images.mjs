#!/usr/bin/env node
// Génère des images à la une ULTRA-RÉALISTES via gpt-image-2 pour les articles FR
// dont l'image d'origine a été supprimée du serveur WP (404). Optimise en webp,
// met à jour data/images.json. Idempotent.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'covers');
const WIDTHS = [400, 800, 1280];
const KEY = process.env.OPENAI_API_KEY;
const CONCURRENCY = 3;
const exists = (p) => access(p).then(() => true).catch(() => false);

function buildPrompt(post) {
  return `Photographie éditoriale ultra-réaliste, qualité magazine premium, illustrant le sujet suivant : « ${post.title} ».
Style : photo authentique, lumière naturelle douce, profondeur de champ soignée, composition élégante et moderne, couleurs riches et naturelles.
Sans aucun texte, sans logo, sans filigrane, sans bordure. Cadrage horizontal, adapté à une image à la une d'article.`;
}

async function generate(post, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: buildPrompt(post), size: '1536x1024', quality: 'medium', n: 1 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const json = await res.json();
      const b64 = json.data?.[0]?.b64_json;
      const url = json.data?.[0]?.url;
      if (b64) return Buffer.from(b64, 'base64');
      if (url) return Buffer.from(await (await fetch(url)).arrayBuffer());
      throw new Error('pas d\'image dans la réponse');
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, (i + 1) * 3000)); }
  }
  throw lastErr;
}

async function processOne(post, imagesMap) {
  const buf = await generate(post);
  const meta = await sharp(buf).metadata();
  for (const w of WIDTHS) {
    await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 74, effort: 4 }).toFile(join(OUT, `${post.id}-${w}.webp`));
  }
  const tiny = await sharp(buf).resize({ width: 24 }).blur(1.2).webp({ quality: 40 }).toBuffer();
  imagesMap[post.id] = {
    base: `/covers/${post.id}`, widths: WIDTHS,
    w: meta.width || 1536, h: meta.height || 1024,
    ratio: +(((meta.width || 1536) / (meta.height || 1024)).toFixed(4)),
    lqip: `data:image/webp;base64,${tiny.toString('base64')}`,
    alt: post.title, generated: true,
  };
}

async function pool(items, worker, size) {
  let idx = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (idx < items.length) { const my = idx++; await worker(items[my]); }
  }));
}

async function main() {
  if (!KEY) throw new Error('OPENAI_API_KEY manquant');
  await mkdir(OUT, { recursive: true });
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const imagesMap = JSON.parse(await readFile(join(ROOT, 'data', 'images.json'), 'utf8'));
  // Cibles : articles FR (image != null) sans fichier optimisé.
  const targets = posts.filter((p) => p.image && !imagesMap[p.id]);
  const limit = Number(process.argv[2]) || targets.length;
  const batch = targets.slice(0, limit);
  console.log(`Génération de ${batch.length}/${targets.length} images (gpt-image-2)…`);

  let ok = 0, fail = 0;
  await pool(batch, async (post) => {
    if (await exists(join(OUT, `${post.id}-1280.webp`))) { ok++; return; }
    try {
      await processOne(post, imagesMap);
      ok++;
      console.log(`  ✓ ${post.id} « ${post.title.slice(0, 50)} »`);
      await writeFile(join(ROOT, 'data', 'images.json'), JSON.stringify(imagesMap, null, 0)); // sauvegarde incrémentale
    } catch (e) { fail++; console.warn(`  ✗ ${post.id} ${String(e.message).slice(0, 140)}`); }
  }, CONCURRENCY);

  await writeFile(join(ROOT, 'data', 'images.json'), JSON.stringify(imagesMap, null, 0));
  console.log(`\n✓ ${ok} images générées, ${fail} échecs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
