import type { APIRoute } from 'astro';
import { getAllArticles } from '../lib/data';

// Index de recherche léger consommé côté client par /recherche.
export const GET: APIRoute = () => {
  const data = getAllArticles().map((a) => ({
    t: a.title,
    u: a.url,
    e: a.excerpt.slice(0, 160),
    g: a.tags,
    d: a.date,
    r: a.readingTime,
    img: a.image ? `${a.image.base}-400.webp` : null,
  }));
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
