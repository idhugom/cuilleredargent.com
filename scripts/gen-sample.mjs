#!/usr/bin/env node
// Génère en SYNCHRONE le contenu d'un échantillon d'articles (vitrine préprod),
// via l'API Responses (gpt-5.6-terra). Écrit data/content/{id}.json.
// Usage: node scripts/gen-sample.mjs [count=16]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBody } from './prompt.mjs';
import { normalizeContent, extractOutputText } from './normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'content');
const KEY = process.env.OPENAI_API_KEY;
const COUNT = Number(process.argv[2]) || 16;
const CONCURRENCY = 4;
const exists = (p) => access(p).then(() => true).catch(() => false);

async function callModel(post, tries = 3) {
  const body = buildBody(post);
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const text = extractOutputText(json);
      if (!text) throw new Error(`sortie vide (status=${json.status})`);
      const parsed = JSON.parse(text);
      return normalizeContent(parsed);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, (i + 1) * 2500));
    }
  }
  throw lastErr;
}

async function pool(items, worker, size) {
  let idx = 0;
  const runners = Array.from({ length: size }, async () => {
    while (idx < items.length) { const my = idx++; await worker(items[my], my); }
  });
  await Promise.all(runners);
}

async function main() {
  if (!KEY) throw new Error('OPENAI_API_KEY manquant');
  await mkdir(OUT, { recursive: true });
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const images = JSON.parse(await readFile(join(ROOT, 'data', 'images.json'), 'utf8'));

  // Sélection : articles FR ayant une image optimisée, répartis dans le catalogue.
  const eligible = posts.filter((p) => images[p.id]);
  const step = Math.max(1, Math.floor(eligible.length / COUNT));
  const picked = [];
  for (let i = 0; i < eligible.length && picked.length < COUNT; i += step) picked.push(eligible[i]);

  console.log(`Génération synchrone de ${picked.length} articles (concurrence ${CONCURRENCY})…`);
  let ok = 0, fail = 0;
  await pool(picked, async (post) => {
    const dest = join(OUT, `${post.id}.json`);
    if (await exists(dest)) { ok++; console.log(`  = ${post.id} déjà présent`); return; }
    try {
      const content = await callModel(post);
      await writeFile(dest, JSON.stringify(content));
      ok++;
      console.log(`  ✓ ${post.id} « ${(content.title || post.title).slice(0, 60)} » (${content.blocks.length} blocs, ${content.faq.length} FAQ)`);
    } catch (e) {
      fail++;
      console.warn(`  ✗ ${post.id} ${String(e.message).slice(0, 160)}`);
    }
  }, CONCURRENCY);

  console.log(`\n✓ ${ok} générés, ${fail} échecs → data/content/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
