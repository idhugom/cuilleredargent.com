// @ts-check
import { defineConfig } from 'astro/config';

// Le site utilise des URLs héritées de la forme /{slug}.asp (100% identiques au
// WordPress d'origine, pour préserver le SEO). On force donc `build.format: 'file'`
// afin qu'Astro émette des fichiers plats, puis un script postbuild normalise en
// {slug}.asp.html — servi par Cloudflare Pages avec le bon Content-Type text/html.
export default defineConfig({
  site: 'https://www.cuilleredargent.com',
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  image: {
    // Les images à la une sont pré-optimisées en webp dans public/covers/ par
    // scripts/fetch-images.mjs — pas d'optimisation Astro au build (builds rapides).
    responsiveStyles: true,
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  devToolbar: { enabled: false },
});
