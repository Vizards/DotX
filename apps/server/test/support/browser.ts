import assert from 'node:assert/strict';
import type { startServer } from './server.ts';

export type Server = Awaited<ReturnType<typeof startServer>>;
export const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

export async function beginLogin(api: Server, returnTo = '/admin') {
  const response = await api.request('/admin/login?return_to=' + encodeURIComponent(returnTo));
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('Location')!);
  return {
    response,
    location,
    callback:
      '/admin/callback?' +
      new URLSearchParams({
        state: location.searchParams.get('state')!,
        code: 'synthetic-cf-code',
      }),
    cookie: cookies(response),
  };
}
export async function login(api: Server) {
  const pending = await beginLogin(api);
  const response = await api.request(pending.callback, { headers: { Cookie: pending.cookie } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/admin');
  const cookie = cookies(response);
  const session = await api.request('/admin/api/session', { headers: { Cookie: cookie } });
  assert.equal(session.status, 200, await session.clone().text());
  const data = (await session.json()) as any;
  return {
    cookie,
    data,
    headers: { Cookie: cookie, Origin: 'http://localhost', 'X-CSRF-Token': data.csrf_token },
  };
}
