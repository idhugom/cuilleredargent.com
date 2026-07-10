// Couche de données : fusionne les métadonnées WordPress (posts.json), les images
// optimisées (images.json) et le contenu régénéré par l'IA (data/content/{id}.json).
// Un article n'est publié que s'il possède un fichier de contenu régénéré.

import rawPosts from '../../data/posts.json';
import rawImages from '../../data/images.json';

export type Block =
  | { type: 'heading'; level: 2 | 3; text: string; id?: string }
  | { type: 'paragraph'; html: string }
  | { type: 'lead'; html: string }
  | { type: 'list'; style: 'bullet' | 'number'; items: string[] }
  | { type: 'callout'; variant: 'info' | 'tip' | 'warning' | 'key'; title?: string; html: string }
  | { type: 'table'; caption?: string; headers: string[]; rows: string[][] }
  | { type: 'comparison'; title?: string; columns: { heading: string; tone?: 'pos' | 'neg' | 'neutral'; points: string[] }[] }
  | { type: 'stats'; items: { value: string; label: string }[] }
  | { type: 'steps'; items: { title: string; html: string }[] }
  | { type: 'quote'; html: string; cite?: string };

export interface ImageData {
  base: string; widths: number[]; w: number; h: number; ratio: number; lqip: string | null; alt: string;
}

export interface Content {
  title?: string;
  metaTitle?: string;
  metaDescription?: string;
  excerpt?: string;
  readingTime?: number;
  tags?: string[];
  keyTakeaways?: string[];
  blocks: Block[];
  faq?: { q: string; a: string }[];
  sources?: { label: string; url?: string }[];
}

export interface Post {
  id: number; slug: string; asp: string; title: string; date: string; modified: string; excerpt: string;
  image: { url: string | null; full?: string; width: number | null; height: number | null; alt: string } | null;
}

export interface Article {
  id: number; slug: string; asp: string; url: string; title: string;
  date: string; modified: string;
  metaTitle: string; metaDescription: string; excerpt: string;
  readingTime: number; tags: string[]; keyTakeaways: string[];
  blocks: Block[]; faq: { q: string; a: string }[]; sources: { label: string; url?: string }[];
  image: ImageData | null;
}

const posts = rawPosts as unknown as Post[];
const images = rawImages as unknown as Record<string, ImageData>;

// Charge tous les contenus régénérés présents dans data/content/*.json
const contentModules = import.meta.glob<{ default: Content }>('../../data/content/*.json', { eager: true });
const contentById = new Map<number, Content>();
for (const [path, mod] of Object.entries(contentModules)) {
  const m = path.match(/(\d+)\.json$/);
  if (m) contentById.set(Number(m[1]), (mod as any).default as Content);
}

function estimateReadingTime(blocks: Block[]): number {
  let words = 0;
  const count = (s?: string) => { if (s) words += s.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length; };
  for (const b of blocks) {
    if ('html' in b) count(b.html);
    if ('text' in b) count((b as any).text);
    if (b.type === 'list') b.items.forEach(count);
    if (b.type === 'steps') b.items.forEach((i) => { count(i.title); count(i.html); });
    if (b.type === 'comparison') b.columns.forEach((c) => c.points.forEach(count));
    if (b.type === 'table') b.rows.forEach((r) => r.forEach(count));
  }
  return Math.max(2, Math.round(words / 210));
}

function toArticle(post: Post, content: Content): Article {
  const img = images[String(post.id)] || null;
  const title = content.title?.trim() || post.title;
  const excerpt = content.excerpt?.trim() || post.excerpt;
  return {
    id: post.id,
    slug: post.slug,
    asp: post.asp,
    url: `/${post.asp}`,
    title,
    date: post.date,
    modified: post.modified,
    metaTitle: content.metaTitle?.trim() || title,
    metaDescription: content.metaDescription?.trim() || excerpt.slice(0, 158),
    excerpt,
    readingTime: content.readingTime || estimateReadingTime(content.blocks || []),
    tags: content.tags || [],
    keyTakeaways: content.keyTakeaways || [],
    blocks: content.blocks || [],
    faq: content.faq || [],
    sources: content.sources || [],
    image: img,
  };
}

let _all: Article[] | null = null;
export function getAllArticles(): Article[] {
  if (_all) return _all;
  _all = posts
    .filter((p) => contentById.has(p.id))
    .map((p) => toArticle(p, contentById.get(p.id)!))
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return _all;
}

export function getArticleByAsp(asp: string): Article | undefined {
  return getAllArticles().find((a) => a.asp === asp);
}

/** Articles liés : partage de tags puis proximité de date. */
export function getRelated(article: Article, n = 3): Article[] {
  const others = getAllArticles().filter((a) => a.id !== article.id);
  const scored = others.map((a) => {
    const shared = a.tags.filter((t) => article.tags.includes(t)).length;
    return { a, score: shared };
  });
  scored.sort((x, y) => y.score - x.score || +new Date(y.a.date) - +new Date(x.a.date));
  return scored.slice(0, n).map((s) => s.a);
}

/** Nombre total d'articles au catalogue (publiés + en attente de contenu). */
export const CATALOG_TOTAL = posts.length;
export const PUBLISHED_TOTAL = () => getAllArticles().length;

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch { return ''; }
}

/** Un jeu de « rubriques » dérivé des tags les plus fréquents, pour la navigation. */
export function topTags(limit = 8): { tag: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const a of getAllArticles()) for (const t of a.tags) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}
