import type { Env } from '../env.ts';
const pages = new Set([
  '/setup/admin',
  '/setup/admin/',
  '/admin',
  '/admin/',
  '/admin/agents',
  '/admin/agents/',
  '/admin/devices',
  '/admin/devices/',
  '/authorize',
  '/authorize/',
]);
export async function assets(request: Request, env: Env): Promise<Response | null> {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (url.pathname === '/')
    return new Response(null, { status: 302, headers: { Location: '/admin' } });
  if (!pages.has(url.pathname)) return null;
  const target = new URL(request.url);
  target.pathname = '/index.html';
  target.search = '';
  const response = await env.ASSETS.fetch(new Request(target, request)),
    headers = new Headers(response.headers);
  // Native same-origin form POSTs need an Origin header for the consent check.
  // no-referrer makes that header "null" in browsers; same-origin still omits
  // referrers when leaving DotX for an OAuth client or external guide.
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(response.body, { status: response.status, headers });
}
