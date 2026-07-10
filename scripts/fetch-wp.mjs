#!/usr/bin/env node
// Extraction complète des métadonnées WordPress → data/posts.json
// Récupère: id, slug, titre, date, modified, lien .asp, image à la une (URL + alt + dimensions), excerpt.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = 'https://www.cuilleredargent.com/wp-json/wp/v2';

// Décodage minimal des entités HTML présentes dans les titres WP.
function decodeEntities(str = '') {
  const named = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'",
    '&#39;': "'", '&apos;': "'", '&hellip;': '…', '&nbsp;': ' ', '&laquo;': '«',
    '&raquo;': '»', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”',
    '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&ccedil;': 'ç', '&ndash;': '–',
    '&mdash;': '—', '&euro;': '€', '&deg;': '°', '&times;': '×',
  };
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z0-9#]+;/gi, (m) => named[m] ?? m);
}

function stripTags(html = '') {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// Choisit la meilleure URL d'image disponible parmi les tailles WP.
function pickImage(media) {
  if (!media) return null;
  const sizes = media.media_details?.sizes || {};
  const order = ['1536x1536', 'large', 'medium_large', 'full', 'bam-featured', 'bam-large'];
  let best = null;
  for (const key of order) {
    if (sizes[key]?.source_url) { best = sizes[key]; break; }
  }
  const full = media.source_url || sizes.full?.source_url || best?.source_url;
  return {
    url: best?.source_url || full,
    full,
    width: best?.width || media.media_details?.width || null,
    height: best?.height || media.media_details?.height || null,
    alt: (media.alt_text || '').trim(),
  };
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'cda-migration/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { data: await res.json(), headers: res.headers };
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, (i + 1) * 1500));
    }
  }
}

async function main() {
  const perPage = 100;
  const first = await getJSON(`${BASE}/posts?per_page=1`);
  const total = Number(first.headers.get('x-wp-total')) || 0;
  const pages = Math.ceil(total / perPage);
  console.log(`Total posts: ${total} → ${pages} pages de ${perPage}`);

  const posts = [];
  for (let p = 1; p <= pages; p++) {
    const url = `${BASE}/posts?per_page=${perPage}&page=${p}` +
      `&_fields=id,slug,date,modified,title,link,excerpt,_links,_embedded` +
      `&_embed=wp:featuredmedia`;
    const { data } = await getJSON(url);
    for (const post of data) {
      const media = post._embedded?.['wp:featuredmedia']?.[0];
      const img = pickImage(media);
      // slug .asp = dernier segment du permalien, sans domaine
      const linkPath = new URL(post.link).pathname.replace(/^\//, ''); // "slug.asp"
      posts.push({
        id: post.id,
        slug: post.slug,
        asp: linkPath, // URL publique historique à préserver (ex: "mon-article.asp")
        title: decodeEntities(post.title?.rendered || ''),
        date: post.date,
        modified: post.modified,
        excerpt: stripTags(post.excerpt?.rendered || '').slice(0, 500),
        image: img,
      });
    }
    console.log(`  page ${p}/${pages} → ${posts.length} cumulés`);
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(join(ROOT, 'data', 'posts.json'), JSON.stringify(posts, null, 2));

  const withImg = posts.filter((p) => p.image?.url).length;
  console.log(`\n✓ ${posts.length} articles écrits dans data/posts.json`);
  console.log(`  ${withImg} avec image à la une, ${posts.length - withImg} sans (génération requise)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
