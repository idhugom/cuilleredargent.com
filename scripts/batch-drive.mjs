#!/usr/bin/env node
// Orchestrateur RÉSUMABLE de régénération de contenu par chunks séquentiels.
// Contourne la limite de tokens en file d'attente d'OpenAI Batch : un seul batch
// en vol à la fois, taille de chunk bornée. État persistant (git) dans
// data/batch/queue.json → reprend exactement après un redémarrage de conteneur.
//
// Étape unique : node scripts/batch-drive.mjs
// Boucle jusqu'à épuisement : node scripts/batch-drive.mjs --loop
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBody } from './prompt.mjs';
import { normalizeContent, extractOutputText } from './normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BATCH_DIR = join(ROOT, 'data', 'batch');
const CONTENT_DIR = join(ROOT, 'data', 'content');
const QUEUE = join(BATCH_DIR, 'queue.json');
const LOCK = join(BATCH_DIR, '.drive.lock');
const KEY = process.env.OPENAI_API_KEY;
const CHUNK_SIZE = 100;
const POLL_MS = 180000;
const LOCK_STALE_MS = 20 * 60 * 1000;

const exists = (p) => access(p).then(() => true).catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

async function loadJSON(p, def) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return def; } }
async function saveQueue(q) { await writeFile(QUEUE, JSON.stringify(q, null, 2)); }

async function doneContentIds() {
  try { return new Set((await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.json')).map((f) => Number(f.replace('.json', '')))); }
  catch { return new Set(); }
}

async function ensureQueue() {
  await mkdir(BATCH_DIR, { recursive: true });
  let q = await loadJSON(QUEUE, null);
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const done = await doneContentIds();
  if (!q) {
    const targets = posts.filter((p) => p.image && !done.has(p.id)).map((p) => p.id);
    const chunks = [];
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      chunks.push({ i: chunks.length, ids: targets.slice(i, i + CHUNK_SIZE), status: 'pending', batchId: null, inputFileId: null, failedIds: [] });
    }
    q = { chunkSize: CHUNK_SIZE, createdAt: new Date().toISOString(), totalTargets: targets.length, chunks };
    await saveQueue(q);
    console.log(`Queue initialisée : ${targets.length} articles en ${chunks.length} chunks de ${CHUNK_SIZE}.`);
  }
  return q;
}

function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return e.stdout?.toString() || ''; } }
function commitPush(msg) {
  git('add data/content data/batch/queue.json');
  const status = git('status --porcelain');
  if (!status.trim()) return;
  git(`commit -q -m ${JSON.stringify(msg)}`);
  for (let i = 0; i < 4; i++) {
    try { execSync('git push origin main', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); return; }
    catch { execSync(`sleep ${2 ** (i + 1)}`); }
  }
}

async function submitChunk(chunk) {
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const done = await doneContentIds();
  const ids = chunk.ids.filter((id) => !done.has(id)); // ne resoumets pas ce qui est déjà fait
  if (!ids.length) { chunk.status = 'integrated'; return 'skip-empty'; }
  const lines = ids.map((id) => JSON.stringify({ custom_id: `art-${id}`, method: 'POST', url: '/v1/responses', body: buildBody(byId.get(id)) }));
  const inputPath = join(BATCH_DIR, `chunk-${chunk.i}.jsonl`);
  await writeFile(inputPath, lines.join('\n') + '\n');
  const fd = new FormData();
  fd.append('purpose', 'batch');
  fd.append('file', new Blob([await readFile(inputPath)], { type: 'application/jsonl' }), `chunk-${chunk.i}.jsonl`);
  const up = await fetch('https://api.openai.com/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd }).then((r) => r.json());
  if (!up.id) throw new Error('upload: ' + JSON.stringify(up).slice(0, 200));
  const batch = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: up.id, endpoint: '/v1/responses', completion_window: '24h', metadata: { project: 'cuilleredargent', chunk: String(chunk.i) } }),
  }).then((r) => r.json());
  if (!batch.id) throw new Error('batch: ' + JSON.stringify(batch).slice(0, 200));
  chunk.batchId = batch.id; chunk.inputFileId = up.id; chunk.status = 'submitted'; chunk.submittedAt = new Date().toISOString();
  return batch.id;
}

async function integrateChunk(chunk, batch) {
  let written = 0;
  const failedIds = [];
  if (batch.output_file_id) {
    const raw = await fetch(`https://api.openai.com/v1/files/${batch.output_file_id}/content`, { headers: { Authorization: `Bearer ${KEY}` } }).then((r) => r.text());
    for (const line of raw.split('\n').filter(Boolean)) {
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const id = Number(String(rec.custom_id || '').replace('art-', ''));
      if (!id) continue;
      try {
        if (rec.error || rec.response?.status_code !== 200) throw new Error('http');
        const text = extractOutputText(rec.response.body);
        const content = normalizeContent(JSON.parse(text));
        await writeFile(join(CONTENT_DIR, `${id}.json`), JSON.stringify(content));
        written++;
      } catch { failedIds.push(id); }
    }
  }
  // les requêtes absentes du fichier de sortie (échec dur) → à retenter
  const done = await doneContentIds();
  for (const id of chunk.ids) if (!done.has(id) && !failedIds.includes(id)) failedIds.push(id);
  chunk.failedIds = failedIds;
  chunk.status = 'integrated';
  chunk.integratedAt = new Date().toISOString();
  return written;
}

async function step(q) {
  const active = q.chunks.find((c) => c.status === 'submitted');
  if (active) {
    const batch = await fetch(`https://api.openai.com/v1/batches/${active.batchId}`, { headers: { Authorization: `Bearer ${KEY}` } }).then((r) => r.json());
    const terminal = ['completed', 'failed', 'expired', 'cancelled'].includes(batch.status);
    console.log(`  chunk ${active.i}: ${batch.status} — ${batch.request_counts?.completed}/${batch.request_counts?.total} ok, ${batch.request_counts?.failed} échecs`);
    if (terminal || batch.output_file_id) {
      const written = await integrateChunk(active, batch);
      await saveQueue(q);
      const total = q.chunks.length;
      const doneN = q.chunks.filter((c) => c.status === 'integrated').length;
      commitPush(`Contenu régénéré : chunk ${active.i + 1}/${total} intégré (+${written} articles)`);
      console.log(`  ✓ chunk ${active.i} intégré (+${written}). ${doneN}/${total} chunks faits.`);
      return 'progress';
    }
    return 'waiting';
  }
  const next = q.chunks.find((c) => c.status === 'pending');
  if (next) {
    const id = await submitChunk(next);
    await saveQueue(q);
    commitPush(`Batch chunk ${next.i + 1}/${q.chunks.length} soumis`);
    console.log(`  → chunk ${next.i} soumis (${id})`);
    return 'progress';
  }
  return 'done';
}

async function acquireLock() {
  if (await exists(LOCK)) {
    const t = Number((await readFile(LOCK, 'utf8')).trim()) || 0;
    if (now() - t < LOCK_STALE_MS) return false;
  }
  await writeFile(LOCK, String(now()));
  return true;
}

async function main() {
  if (!KEY) throw new Error('OPENAI_API_KEY manquant');
  const loop = process.argv.includes('--loop');
  if (!(await acquireLock())) { console.log('Un autre driver est actif (lock frais). Sortie.'); return; }
  const q = await ensureQueue();
  do {
    await writeFile(LOCK, String(now())); // rafraîchit le lock
    const st = await step(q);
    if (st === 'done') { console.log('✓ Tous les chunks sont intégrés.'); break; }
    if (loop) await sleep(st === 'waiting' ? POLL_MS : 5000);
  } while (loop);
  const remaining = q.chunks.filter((c) => c.status !== 'integrated').length;
  const failed = q.chunks.reduce((n, c) => n + (c.failedIds?.length || 0), 0);
  console.log(`État : ${q.chunks.length - remaining}/${q.chunks.length} chunks intégrés, ${failed} échecs individuels à retenter.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
