import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startServer } from '../support/server.ts';
import { cookies } from '../support/browser.ts';
import { beginAuthorization } from '../support/oauth.ts';

type Server = Awaited<ReturnType<typeof startServer>>;
const post = (api: Server, path: string, cookie = '', body: unknown = {}, csrf = '') =>
  api.request(path, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(body),
  });
const read = async (response: Response) => {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<any>;
};
async function begin(api: Server, return_to = '/admin') {
  const response = await post(api, '/admin/auth/cloudflare/start', '', {
    return_to,
  });
  const result = await read(response);
  assert.equal(new URL(result.authorization_url).origin, 'https://oauth.dotx.run');
  const flow = api.cloudflare.authorizations.at(-1)!;
  const cookie = cookies(response);
  const callback =
    '/admin/auth/cloudflare/callback?' +
    new URLSearchParams({ state: flow.state, code: flow.code }).toString();
  return { flow, cookie, callback };
}
async function login(api: Server, returnTo?: string) {
  const flow = await begin(api, returnTo);
  assert.equal(
    (await api.request(flow.callback, { headers: { Cookie: flow.cookie } })).status,
    303,
  );
  const response = await post(api, '/admin/auth/cloudflare/complete', flow.cookie);
  const result = await read(response);
  const cookie = cookies(response);
  const session = await read(
    await api.request('/admin/api/session', { headers: { Cookie: cookie } }),
  );
  return { ...flow, cookie, session, result };
}

test('CF login binds browser/state/PKCE, isolates Wrangler and persists initialization', async (t) => {
  const api = await startServer(t);
  assert.equal((await read(await api.request('/admin/auth/methods'))).initialized, false);
  const discovery = await read(await api.request('/.well-known/dotx-oauth'));
  assert.equal(discovery.callback_uri, 'http://localhost/admin/auth/cloudflare/callback');
  assert.equal(discovery.key.d, undefined);
  const a = await begin(api);
  const b = await begin(api, '//evil.example');
  for (const response of [
    await api.request(a.callback),
    await api.request(a.callback, { headers: { Cookie: b.cookie } }),
  ]) {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), '/login/cloudflare?error=expired');
  }
  const callbacks = await Promise.all(
    Array.from({ length: 2 }, () => api.request(a.callback, { headers: { Cookie: a.cookie } })),
  );
  assert(callbacks.every((r) => r.status === 303));
  assert.deepEqual(callbacks.map((r) => r.headers.get('Location')).sort(), [
    '/login/cloudflare',
    '/login/cloudflare?error=expired',
  ]);
  const response = await post(api, '/admin/auth/cloudflare/complete', a.cookie);
  await read(response);
  const cookie = cookies(response);
  const info = await read(await api.request('/admin/api/session', { headers: { Cookie: cookie } }));
  assert.equal(info.subject, 'test-user');
  assert(info.expires_at > Date.now() + 29 * 24 * 3600_000, 'no 12-hour absolute expiry');
  assert.equal((await post(api, '/admin/auth/cloudflare/complete', a.cookie)).status, 401);
  assert.equal(
    (
      await api.request('/admin/api/session', {
        headers: { Authorization: 'Bearer synthetic-browser-access-1' },
      })
    ).status,
    401,
    'browser audience is not accepted by the Wrangler path',
  );
  assert.equal((await post(api, '/admin/logout', cookie)).status, 403);
  await api.reload({});
  const methods = await read(await api.request('/admin/auth/methods'));
  assert.equal(methods.initialized, true);
  assert.equal(methods.configured, false);
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal((await api.request(b.callback, { headers: { Cookie: b.cookie } })).status, 303);
  assert.equal(
    (await read(await post(api, '/admin/auth/cloudflare/complete', b.cookie))).return_to,
    '/admin',
  );
});

test('CF expiry and early 401 refresh once under concurrency, rotate credentials, and preserve sessions on temporary failure', async (t) => {
  const api = await startServer(t);
  const current = await login(api);
  api.cloudflare.tokens.get('synthetic-browser-access-1')!.active = false;
  api.cloudflare.expiresIn = 1;
  const requests = () =>
    Promise.all(
      Array.from({ length: 2 }, () =>
        api.request('/admin/api/session', { headers: { Cookie: current.cookie } }),
      ),
    );
  assert((await requests()).every((r) => r.status === 200));
  assert.equal(api.cloudflare.refreshCount, 1);
  await delay(1100);
  api.cloudflare.refreshStatus = 503;
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: current.cookie } })).status,
    503,
  );
  api.cloudflare.refreshStatus = 200;
  api.cloudflare.expiresIn = 3600;
  const before = api.cloudflare.refreshCount;
  assert((await requests()).every((r) => r.status === 200));
  assert.equal(api.cloudflare.refreshCount, before + 1);
  const refreshes = api.cloudflare.calls.filter(
    (call) => call.body.get('grant_type') === 'refresh_token',
  );
  assert.equal(refreshes.at(-1)!.body.get('refresh_token'), 'synthetic-refresh-2');
  api.cloudflare.status = 429;
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: current.cookie } })).status,
    503,
  );
  api.cloudflare.status = 200;
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: current.cookie } })).status,
    200,
  );
});

test('logout wins an in-flight refresh and works when the provider is unavailable', async (t) => {
  const api = await startServer(t);
  const current = await login(api);
  api.cloudflare.tokens.get('synthetic-browser-access-1')!.active = false;
  let entered!: () => void, resume!: () => void;
  const refreshing = new Promise<void>((resolve) => (entered = resolve));
  const release = new Promise<void>((resolve) => (resume = resolve));
  api.cloudflare.refreshWait = async () => {
    entered();
    await release;
  };
  const reading = api.request('/admin/api/session', { headers: { Cookie: current.cookie } });
  await refreshing;
  const logout = await post(api, '/admin/logout', current.cookie, {}, current.session.csrf_token);
  assert.equal(logout.status, 200);
  resume();
  assert.equal((await reading).status, 401);
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: current.cookie } })).status,
    401,
  );
  api.cloudflare.refreshWait = undefined;
  const next = await login(api);
  api.cloudflare.status = 503;
  assert.equal(
    (await post(api, '/admin/logout', next.cookie, {}, next.session.csrf_token)).status,
    200,
  );
});

test('CF permission loss and invalid refresh end only CF sessions; credential changes retain CF validation', async (t) => {
  const api = await startServer(t);
  const current = await login(api);
  const saved = await post(
    api,
    '/admin/auth/password/set',
    current.cookie,
    { password: 'local-password' },
    current.session.csrf_token,
  );
  await read(saved);
  const providerCookie = cookies(saved);
  const local = await post(api, '/admin/auth/password', '', { password: 'local-password' });
  await read(local);
  api.cloudflare.member.status = 'pending';
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: providerCookie } })).status,
    403,
  );
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: cookies(local) } })).status,
    200,
  );
  api.cloudflare.member.status = 'accepted';
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: providerCookie } })).status,
    401,
  );
  const other = await login(api);
  api.cloudflare.tokens.get('synthetic-browser-access-2')!.active = false;
  api.cloudflare.refreshStatus = 400;
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: other.cookie } })).status,
    401,
  );
  api.cloudflare.refreshStatus = 200;
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: other.cookie } })).status,
    401,
  );
});

test('CF denied membership, invalid audience and cancellation never create management sessions', async (t) => {
  const api = await startServer(t);
  api.cloudflare.member.account.id = 'another-account';
  const flow = await begin(api);
  assert.equal(
    (await api.request(flow.callback, { headers: { Cookie: flow.cookie } })).status,
    303,
  );
  const denied = await post(api, '/admin/auth/cloudflare/complete', flow.cookie);
  assert.equal(denied.status, 403);
  const failure = ((await denied.json()) as any).error;
  assert.equal(failure.details.email, 'synthetic@example.com');
  assert.equal(failure.code, 'NOT_A_TARGET_ACCOUNT_MEMBER');
  assert.equal(api.cloudflare.tokens.get('synthetic-browser-access-1')!.active, false);
  assert.equal((await read(await api.request('/admin/auth/methods'))).initialized, false);
  api.cloudflare.member.account.id = 'test-account';
  api.cloudflare.browserAudience = 'not-this-client';
  const invalid = await begin(api);
  await api.request(invalid.callback, { headers: { Cookie: invalid.cookie } });
  assert.equal((await post(api, '/admin/auth/cloudflare/complete', invalid.cookie)).status, 401);
  const cancel = await begin(api);
  const cancelled = await api.request(
    '/admin/auth/cloudflare/callback?' +
      new URLSearchParams({ state: cancel.flow.state, error: 'access_denied' }),
    { headers: { Cookie: cancel.cookie } },
  );
  assert.equal(cancelled.status, 303);
  const completed = await post(api, '/admin/auth/cloudflare/complete', cancel.cookie);
  assert.equal(completed.status, 403);
  assert.equal(((await completed.json()) as any).error.code, 'CF_AUTHORIZATION_CANCELLED');
});

test('removing the last password enforces CSRF and preserves initialization', async (t) => {
  const api = await startServer(t);
  const current = await login(api);
  const saved = await post(
    api,
    '/admin/auth/password/set',
    current.cookie,
    { password: 'local-password' },
    current.session.csrf_token,
  );
  await read(saved);
  const cookie = cookies(saved);
  const session = await read(
    await api.request('/admin/api/session', { headers: { Cookie: cookie } }),
  );
  assert.equal(
    (
      await api.request('/admin/api/password', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost', Cookie: cookie },
      })
    ).status,
    403,
  );
  const removed = await api.request('/admin/api/password', {
    method: 'DELETE',
    headers: { Origin: 'http://localhost', Cookie: cookie, 'X-CSRF-Token': session.csrf_token },
  });
  await read(removed);
  const methods = await read(await api.request('/admin/auth/methods'));
  assert.equal(methods.configured, false);
  assert.equal(methods.initialized, true);
  assert.equal(
    (await post(api, '/admin/auth/password', '', { password: 'local-password' })).status,
    401,
  );
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: cookies(removed) } })).status,
    200,
  );
});

test('CF login returns to the same PA request without approving it', async (t) => {
  const api = await startServer(t);
  const authorization = await beginAuthorization(api.request);
  const current = await login(api, '/authorize?transaction=' + authorization.transaction);
  assert.equal(current.result.return_to, '/authorize?transaction=' + authorization.transaction);
  assert.equal((await api.admin('/agents')).agents.length, 0);
  assert.equal((await authorization.finish(true)).status, 409);
});

test('Agent reset links stay one-use and preserve old login until saved, then revoke prior browser sessions', async (t) => {
  const api = await startServer(t);
  const setup = await api.admin('/setup', 'POST');
  const set = (url: string, password: string) =>
    api.request('/admin/auth/password/set', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        'X-DotX-Setup': new URL(url).hash.slice(1),
      },
      body: JSON.stringify({ password }),
    });
  await read(await set(setup.setup_url, 'old'));
  assert.equal((await set(setup.setup_url, 'replay')).status, 401);
  const old = await post(api, '/admin/auth/password', '', { password: 'old' });
  await read(old);
  const provider = await login(api);
  const reset = await api.admin('/reset-login', 'POST');
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: cookies(old) } })).status,
    200,
  );
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: provider.cookie } })).status,
    200,
    'the CF session is still live before saving the reset',
  );
  const fresh = await set(reset.setup_url, 'new');
  await read(fresh);
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: cookies(old) } })).status,
    401,
  );
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: provider.cookie } })).status,
    401,
  );
  assert.equal((await post(api, '/admin/auth/password', '', { password: 'old' })).status, 401);
  assert.equal((await post(api, '/admin/auth/password', '', { password: 'new' })).status, 200);
  assert.equal((await set(reset.setup_url, 'replay')).status, 401);
});
