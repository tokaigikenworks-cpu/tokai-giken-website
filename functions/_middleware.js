const CANONICAL_HOST = 'tokai-giken.com';
const LEGACY_HOST = `www.${CANONICAL_HOST}`;

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === LEGACY_HOST) {
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
