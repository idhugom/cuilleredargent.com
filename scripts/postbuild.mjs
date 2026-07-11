#!/usr/bin/env node
// Post-traitement du build Astro pour Cloudflare Pages :
//  1. Aplatit les pages d'articles {slug}.asp.html → {slug}.asp (URLs héritées exactes)
//  2. Écrit _headers (Content-Type des .asp + cache long des assets)
//  3. Écrit _redirects (apex → www, actif une fois le domaine rattaché)
//  4. Génère sitemap.xml et robots.txt
import { readdir, rename, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://www.cuilleredargent.com';

async function flattenAsp() {
  const entries = await readdir(DIST);
  let n = 0;
  for (const name of entries) {
    if (name.endsWith('.asp.html')) {
      const from = join(DIST, name);
      const to = join(DIST, name.replace(/\.html$/, '')); // {slug}.asp
      await rename(from, to);
      n++;
    }
  }
  return n;
}

async function writeHeaders() {
  const content = `# Généré par postbuild — servir les URLs héritées .asp en HTML
/*.asp
  Content-Type: text/html; charset=utf-8
  Cache-Control: public, max-age=0, must-revalidate
  X-Content-Type-Options: nosniff

# Données rafraîchies à chaque déploiement (évite un index de recherche périmé)
/search-index.json
  Cache-Control: public, max-age=0, must-revalidate
/sitemap.xml
  Cache-Control: public, max-age=3600
/rss.xml
  Cache-Control: public, max-age=3600

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/covers/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`;
  await writeFile(join(DIST, '_headers'), content);
}

async function writeRedirects() {
  // La redirection apex → www est gérée par functions/_middleware.js (host-based),
  // car _redirects ne matche que le chemin, pas le hostname, sur Cloudflare Pages.
  const content = `# Redirections par chemin (apex → www géré par functions/_middleware.js)
`;
  await writeFile(join(DIST, '_redirects'), content);
}

async function buildSitemap() {
  const posts = JSON.parse(await readFile(join(ROOT, 'data', 'posts.json'), 'utf8'));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const contentDir = join(ROOT, 'data', 'content');
  let ids = [];
  try {
    ids = (await readdir(contentDir)).filter((f) => f.endsWith('.json')).map((f) => Number(f.replace('.json', '')));
  } catch {}

  const urls = [];
  urls.push({ loc: `${SITE}/`, priority: '1.0', changefreq: 'daily' });
  urls.push({ loc: `${SITE}/articles`, priority: '0.8', changefreq: 'daily' });
  urls.push({ loc: `${SITE}/a-propos`, priority: '0.3', changefreq: 'monthly' });
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    urls.push({ loc: `${SITE}/${p.asp}`, lastmod: (p.modified || p.date || '').slice(0, 10), priority: '0.7', changefreq: 'monthly' });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
  await writeFile(join(DIST, 'sitemap.xml'), xml);
  return urls.length;
}

async function writeRobots() {
  const content = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
  await writeFile(join(DIST, 'robots.txt'), content);
}

async function main() {
  const flattened = await flattenAsp();
  await writeHeaders();
  await writeRedirects();
  const sm = await buildSitemap();
  await writeRobots();
  console.log(`postbuild ✓ — ${flattened} pages .asp aplaties, sitemap ${sm} URLs, _headers/_redirects/robots écrits`);
}

main().catch((e) => { console.error(e); process.exit(1); });
