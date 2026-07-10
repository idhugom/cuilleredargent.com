import rss from '@astrojs/rss';
import { getAllArticles } from '../lib/data';

export function GET(context) {
  const articles = getAllArticles();
  return rss({
    title: "Cuillère d'argent",
    description: "Le magazine qui déniche, décortique et raconte — maison, tech, auto, voyage et bien plus.",
    site: context.site ?? 'https://www.cuilleredargent.com',
    items: articles.slice(0, 50).map((a) => ({
      title: a.title,
      description: a.excerpt,
      link: a.url,
      pubDate: new Date(a.date),
      categories: a.tags,
    })),
    customData: `<language>fr-FR</language>`,
    stylesheet: false,
  });
}
