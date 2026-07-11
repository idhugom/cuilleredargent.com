// Cloudflare Pages Function (middleware global).
// Redirige l'apex cuilleredargent.com → www.cuilleredargent.com (301, canonique),
// en préservant le chemin et la query string. Sinon, sert l'asset statique.
// (Les règles host-based de _redirects ne fonctionnent pas sur Pages : seul le
// chemin est matché — d'où cette fonction.)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'cuilleredargent.com') {
    url.hostname = 'www.cuilleredargent.com';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
