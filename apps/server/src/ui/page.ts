export const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const administratorHelp = `<p>Ask Codex managing your DotX setup to open an administrator link in this browser, then return here.</p>`;

export function page(
  title: string,
  body: string,
  { allowClientRedirect = false, ...init }: ResponseInit & { allowClientRedirect?: boolean } = {},
) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  // Keep same-origin form provenance without sending referrers off-site.
  headers.set('Referrer-Policy', 'same-origin');
  headers.set(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; ${allowClientRedirect ? '' : "form-action 'self'; "}frame-ancestors 'none'; base-uri 'none'`,
  );
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · DotX</title><link rel="icon" href="/branding/dotx.png">
<style>
  :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
  body { max-width: 40rem; margin: 2rem auto; padding: 0 1rem; overflow-wrap: anywhere; }
  header { font-weight: 600; }
  header img { vertical-align: middle; margin-right: 0.5rem; }
  h1 { font-size: 1.5rem; }
  pre { white-space: pre-wrap; }
  button { font: inherit; padding: 0.3rem 0.75rem; max-width: 100%; overflow-wrap: anywhere; }
</style></head><body><main><header><img src="/branding/dotx.png" alt="" width="32" height="32">DotX</header>
<h1>${esc(title)}</h1>${body}</main></body></html>`,
    { ...init, headers },
  );
}

export function errorPage(title: string, message: string, detail: unknown, status: number) {
  return page(title, `<p>${esc(message)}</p><pre>${esc(JSON.stringify(detail, null, 2))}</pre>`, {
    status,
  });
}
