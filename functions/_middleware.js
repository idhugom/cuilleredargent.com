// DEBUG temporaire : expose le hostname vu par la Function pour diagnostiquer apex→www.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;
  if (host === 'cuilleredargent.com') {
    url.hostname = 'www.cuilleredargent.com';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  const res = await context.next();
  const r = new Response(res.body, res);
  r.headers.set('x-mw-host', host);
  r.headers.set('x-mw-ran', '1');
  return r;
}
