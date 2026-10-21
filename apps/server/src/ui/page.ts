export const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const administratorHelp = `<p>Ask Codex managing your DotX setup to open an administrator link, then return to this page.</p>
  <details><summary>Setup details</summary><p>On the Mac with administrator credentials, Codex can run <code>setup.mjs admin-link</code> and open its single-use link in this browser session.</p></details>`;

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
  :root { color-scheme: light; font: 16px/1.6 system-ui, sans-serif; color: #252826; background: #f4f5f1; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 20px; }
  main { max-width: 640px; margin: auto; padding: 32px; background: #fff; border: 1px solid #dfe3db; border-radius: 20px; }
  header { display: flex; gap: 12px; align-items: center; font-size: 20px; font-weight: 650; margin-bottom: 28px; }
  header img { border-radius: 12px; }
  h1 { font-size: 28px; line-height: 1.25; margin: 0 0 20px; overflow-wrap: anywhere; }
  h2 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 12px 0; }
  code, pre, dd { overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; font-size: 13px; }
  dl { margin: 20px 0; } dt { color: #62685f; font-size: 14px; } dd { margin: 0 0 12px; }
  fieldset { border: 0; padding: 0; margin: 24px 0; }
  legend { font-weight: 650; margin-bottom: 12px; }
  label { display: flex; gap: 12px; align-items: start; padding: 14px 0; cursor: pointer; }
  input[type=checkbox] { margin-top: 5px; width: 18px; height: 18px; flex-shrink: 0; accent-color: #345845; }
  small { display: block; color: #62685f; font-size: 14px; margin-top: 4px; }
  .notice { background: #f3f5ee; border: 1px solid #dfe3db; padding: 16px; border-radius: 12px; margin: 20px 0; }
  details { margin: 16px 0; font-size: 14px; } summary { cursor: pointer; font-weight: 600; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  button { font: inherit; font-weight: 600; color: white; background: #345845; border: 1px solid #345845; border-radius: 10px; padding: 12px 20px; cursor: pointer; overflow-wrap: anywhere; max-width: 100%; }
  button:hover { background: #274435; }
  button.secondary { background: white; color: #252826; border-color: #c9cfc4; }
  :focus-visible { outline: 3px solid #87a995; outline-offset: 3px; }
  @media(max-width: 480px) { body { padding: 16px 12px; } main { padding: 24px 20px; } h1 { font-size: 24px; } .actions button { width: 100%; } }
</style></head><body><main><header><img src="/branding/dotx.png" alt="" width="44" height="44"><span>DotX</span></header>
<h1>${esc(title)}</h1>${body}</main></body></html>`,
    { ...init, headers },
  );
}

export function errorPage(title: string, message: string, detail: unknown, status: number) {
  return page(
    title,
    `<p>${esc(message)}</p><details><summary>Technical details</summary><pre>${esc(JSON.stringify(detail, null, 2))}</pre></details>`,
    { status },
  );
}
