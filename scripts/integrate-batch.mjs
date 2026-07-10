#!/usr/bin/env node
// Télécharge le résultat du Batch OpenAI, parse/normalise chaque réponse et écrit
// data/content/{id}.json. Récapitule les échecs (à relancer si besoin).
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeContent, extractOutputText } from './normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'content');
const KEY = process.env.OPENAI_API_KEY;
const exists = (p) => access(p).then(() => true).catch(() => false);

async function main() {
  await mkdir(OUT, { recursive: true });
  const info = JSON.parse(await readFile(join(ROOT, 'data', 'batch', 'batch-info.json'), 'utf8'));
  const b = await fetch(`https://api.openai.com/v1/batches/${info.batchId}`, { headers: { Authorization: `Bearer ${KEY}` } }).then((r) => r.json());
  console.log(`Batch ${b.id} — statut ${b.status}, complétées ${b.request_counts?.completed}/${b.request_counts?.total}`);
  if (!b.output_file_id) { console.log('Pas encore de fichier de sortie. Réessaie plus tard.'); return; }

  const raw = await fetch(`https://api.openai.com/v1/files/${b.output_file_id}/content`, { headers: { Authorization: `Bearer ${KEY}` } }).then((r) => r.text());
  const lines = raw.split('\n').filter(Boolean);
  console.log(`${lines.length} réponses reçues.`);

  let ok = 0, fail = 0;
  const failures = [];
  const force = process.argv.includes('--force');
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const id = Number(String(rec.custom_id || '').replace('art-', ''));
    if (!id) continue;
    const dest = join(OUT, `${id}.json`);
    if (!force && await exists(dest)) { ok++; continue; }
    try {
      if (rec.error || rec.response?.status_code !== 200) throw new Error(`http ${rec.response?.status_code}`);
      const text = extractOutputText(rec.response.body);
      if (!text) throw new Error('sortie vide');
      const content = normalizeContent(JSON.parse(text));
      await writeFile(dest, JSON.stringify(content));
      ok++;
    } catch (e) {
      fail++;
      failures.push({ id, error: String(e.message).slice(0, 120) });
    }
  }
  if (failures.length) {
    await writeFile(join(ROOT, 'data', 'batch', 'failures.json'), JSON.stringify(failures, null, 2));
  }
  console.log(`\n✓ ${ok} contenus écrits, ${fail} échecs${failures.length ? ` (voir data/batch/failures.json)` : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
