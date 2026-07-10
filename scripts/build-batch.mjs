#!/usr/bin/env node
// Construit et soumet le Batch OpenAI pour régénérer TOUT le contenu restant.
// Cible : articles FR (avec image non nulle) n'ayant pas encore de contenu généré.
// Exclut les 10 doublons/spam indonésiens (image === null).
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBody } from './prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BATCH_DIR = join(ROOT, 'data', 'batch');
const KEY = process.env.OPENAI_API_KEY;
const exists = (p) => access(p).then(() => true).catch(() => false);

async function main() {
  if (!KEY) throw new Error('OPENAI_API_KEY manquant');
  await mkdir(BATCH_DIR, { recursive: true });
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));

  const contentDir = join(ROOT, 'data', 'content');
  let done = new Set();
  try {
    done = new Set((await readdir(contentDir)).filter((f) => f.endsWith('.json')).map((f) => Number(f.replace('.json', ''))));
  } catch {}

  // Cibles : article FR (image != null) sans contenu déjà généré.
  const targets = posts.filter((p) => p.image && !done.has(p.id));
  const excluded = posts.filter((p) => !p.image).length; // spam indonésien
  console.log(`Articles: ${posts.length} · déjà générés: ${done.size} · exclus (spam): ${excluded} · à traiter: ${targets.length}`);

  const lines = targets.map((p) => JSON.stringify({
    custom_id: `art-${p.id}`,
    method: 'POST',
    url: '/v1/responses',
    body: buildBody(p),
  }));
  const inputPath = join(BATCH_DIR, 'batch-input.jsonl');
  await writeFile(inputPath, lines.join('\n') + '\n');
  const bytes = Buffer.byteLength(lines.join('\n'));
  console.log(`JSONL écrit: ${inputPath} (${(bytes / 1e6).toFixed(1)} Mo, ${lines.length} requêtes)`);

  // Upload
  const fd = new FormData();
  fd.append('purpose', 'batch');
  fd.append('file', new Blob([await readFile(inputPath)], { type: 'application/jsonl' }), 'batch-input.jsonl');
  const up = await fetch('https://api.openai.com/v1/files', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd,
  }).then((r) => r.json());
  if (!up.id) throw new Error('upload échoué: ' + JSON.stringify(up).slice(0, 300));
  console.log(`Fichier uploadé: ${up.id} (${up.bytes} o, ${up.status})`);

  // Création du batch
  const batch = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: up.id, endpoint: '/v1/responses', completion_window: '24h', metadata: { project: 'cuilleredargent', kind: 'content-regen' } }),
  }).then((r) => r.json());
  if (!batch.id) throw new Error('création batch échouée: ' + JSON.stringify(batch).slice(0, 300));

  const info = {
    batchId: batch.id,
    inputFileId: up.id,
    endpoint: '/v1/responses',
    count: lines.length,
    status: batch.status,
    createdAt: new Date().toISOString(),
    targetIds: targets.map((t) => t.id),
  };
  await writeFile(join(BATCH_DIR, 'batch-info.json'), JSON.stringify(info, null, 2));
  console.log(`\n✓ Batch créé: ${batch.id} (${batch.status}) — ${lines.length} articles`);
  console.log(`  Suivi: npm run batch:poll   ·   Intégration: npm run batch:integrate`);
}

main().catch((e) => { console.error(e); process.exit(1); });
