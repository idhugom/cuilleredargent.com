#!/usr/bin/env node
// Affiche l'état du Batch OpenAI en cours (data/batch/batch-info.json).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.OPENAI_API_KEY;

const info = JSON.parse(await readFile(join(ROOT, 'data', 'batch', 'batch-info.json'), 'utf8'));
const b = await fetch(`https://api.openai.com/v1/batches/${info.batchId}`, {
  headers: { Authorization: `Bearer ${KEY}` },
}).then((r) => r.json());

console.log(`Batch ${b.id}`);
console.log(`  statut     : ${b.status}`);
console.log(`  requêtes   : ${b.request_counts?.completed ?? 0}/${b.request_counts?.total ?? info.count} complétées, ${b.request_counts?.failed ?? 0} échecs`);
console.log(`  output file: ${b.output_file_id || '—'}`);
console.log(`  error file : ${b.error_file_id || '—'}`);
if (b.errors) console.log(`  erreurs    : ${JSON.stringify(b.errors).slice(0, 300)}`);
