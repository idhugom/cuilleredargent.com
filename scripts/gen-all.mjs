#!/usr/bin/env node
// Régénère TOUT le contenu restant via l'API Responses SYNCHRONE parallélisée.
// (gpt-5.6-terra n'a pas de variante Batch — l'API Batch suffixe en '-batch'
// et échoue. Le synchrone parallélisé est fiable et plus rapide.)
// Résumable : saute les articles déjà présents dans data/content/. Commit+push
// périodique → progression versionnée (survit aux redémarrages) + rebuild CF.
//
//   node scripts/gen-all.mjs            # tout le reste
//   node scripts/gen-all.mjs 50         # limite à 50 (test)
import { readFile, writeFile, mkdir, readdir, access, unlink } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBody } from './prompt.mjs';
import { normalizeContent, extractOutputText } from './normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'content');
const BATCH_DIR = join(ROOT, 'data', 'batch');
const LOCK = join(BATCH_DIR, '.gen.lock');
const KEY = process.env.OPENAI_API_KEY;
const CONCURRENCY = Number(process.env.GEN_CONCURRENCY) || 8;
const COMMIT_EVERY = 40;
const LOCK_STALE_MS = 20 * 60 * 1000;
const exists = (p) => access(p).then(() => true).catch(() => false);

async function callModel(post, tries = 4) {
  const body = buildBody(post);
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`retryable HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const json = await res.json();
      const text = extractOutputText(json);
      if (!text) throw new Error(`sortie vide (status=${json.status})`);
      return normalizeContent(JSON.parse(text));
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, (i + 1) * 3000 + Math.floor((post.id % 7) * 400)));
    }
  }
  throw lastErr;
}

function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return e.stdout?.toString() || ''; } }
function commitPush(msg) {
  git('add data/content');
  if (!git('status --porcelain data/content').trim()) return;
  git(`commit -q -m ${JSON.stringify(msg)}`);
  for (let i = 0; i < 4; i++) {
    try { execSync('git push origin main', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); return; }
    catch { try { execSync(`sleep ${2 ** (i + 1)}`); } catch {} }
  }
}

async function main() {
  if (!KEY) throw new Error('OPENAI_API_KEY manquant');
  await mkdir(OUT, { recursive: true });
  await mkdir(BATCH_DIR, { recursive: true });

  // lock (évite deux générateurs concurrents)
  if (await exists(LOCK)) {
    const t = Number((await readFile(LOCK, 'utf8')).trim()) || 0;
    if (Date.now() - t < LOCK_STALE_MS) { console.log('Un autre générateur est actif (lock frais). Sortie.'); return; }
  }
  await writeFile(LOCK, String(Date.now()));
  const refresh = setInterval(() => writeFile(LOCK, String(Date.now())).catch(() => {}), 60000);

  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const done = new Set((await readdir(OUT)).filter((f) => f.endsWith('.json')).map((f) => Number(f.replace('.json', ''))));
  let targets = posts.filter((p) => p.image && !done.has(p.id));
  const limit = Number(process.argv[2]);
  if (Number.isFinite(limit)) targets = targets.slice(0, limit);

  console.log(`À générer : ${targets.length} articles (concurrence ${CONCURRENCY}, commit tous les ${COMMIT_EVERY}).`);
  let ok = 0, fail = 0, sinceCommit = 0;
  const failures = [];
  let idx = 0;

  async function worker() {
    while (idx < targets.length) {
      const post = targets[idx++];
      const dest = join(OUT, `${post.id}.json`);
      if (await exists(dest)) { ok++; continue; }
      try {
        const content = await callModel(post);
        await writeFile(dest, JSON.stringify(content));
        ok++; sinceCommit++;
        if (ok % 10 === 0) console.log(`  … ${ok} faits, ${fail} échecs (idx ${idx}/${targets.length})`);
        if (sinceCommit >= COMMIT_EVERY) { sinceCommit = 0; commitPush(`Contenu régénéré : lot de ${COMMIT_EVERY} articles (${ok} au total)`); }
      } catch (e) {
        fail++; failures.push({ id: post.id, slug: post.slug, error: String(e.message).slice(0, 120) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  commitPush(`Contenu régénéré : finalisation (${ok} articles générés)`);
  if (failures.length) await writeFile(join(BATCH_DIR, 'gen-failures.json'), JSON.stringify(failures, null, 2));
  clearInterval(refresh);
  await unlink(LOCK).catch(() => {});
  console.log(`\n✓ Terminé : ${ok} présents/générés, ${fail} échecs${failures.length ? ' (data/batch/gen-failures.json)' : ''}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
