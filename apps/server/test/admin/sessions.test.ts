import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../support/server.ts';
import { beginLogin, cookies, login } from '../support/browser.ts';

const sessionPath = '/admin/api/session';
const refreshCalls = (api: Awaited<ReturnType<typeof startServer>>) =>
  api.cloudflare.calls.filter((call) => call.body.get('grant_type') === 'refresh_token');

test('browser login binds the callback, consumes it once and restricts return destinations', async (t) => {
  const api = await startServer(t);
  const pending = await beginLogin(api, '/admin/devices');
  assert.equal(pending.location.origin, 'https://dash.cloudflare.com');
  assert.equal(pending.location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    pending.location.searchParams.get('redirect_uri'),
    'http://localhost/admin/callback',
  );
  assert.match(pending.response.headers.get('Set-Cookie')!, /HttpOnly; SameSite=Lax/);
  for (const [path, cookie] of [
    [pending.callback.replace(/state=[^&]+/, 'state=wrong'), pending.cookie],
    [pending.callback, 'dotx-admin-login=wrong-browser'],
  ]) {
    const failed = await api.request(path!, { headers: { Cookie: cookie! } });
    assert.equal(failed.status, 303);
    assert.equal(failed.headers.get('Location'), '/admin?login_error=CF_LOGIN_EXPIRED');
    assert(!cookies(failed).includes('dotx-admin='));
  }
  assert.equal(api.cloudflare.calls.length, 0, 'invalid callbacks must not exchange tokens');
  const completed = await api.request(pending.callback, { headers: { Cookie: pending.cookie } });
  assert.equal(completed.headers.get('Location'), '/admin/devices');
  const exchange = api.cloudflare.calls.find(
    (call) => call.body.get('grant_type') === 'authorization_code',
  )!;
  assert.equal(
    createHash('sha256').update(exchange.body.get('code_verifier')!).digest('base64url'),
    pending.location.searchParams.get('code_challenge'),
  );
  const adminCookie = cookies(completed);
  const session = await api.request(sessionPath, { headers: { Cookie: adminCookie } });
  assert.equal(session.status, 200);
  await session.text();
  const callCount = api.cloudflare.calls.length;
  const replay = await api.request(pending.callback, { headers: { Cookie: pending.cookie } });
  assert.equal(replay.headers.get('Location'), '/admin?login_error=CF_LOGIN_EXPIRED');
  assert.equal(api.cloudflare.calls.length, callCount);
  const unsafe = await beginLogin(api, 'https://untrusted.example/');
  const safe = await api.request(unsafe.callback, { headers: { Cookie: unsafe.cookie } });
  assert.equal(safe.headers.get('Location'), '/admin');
});

test('browser writes require origin and CSRF without blocking a corrected retry', async (t) => {
  const api = await startServer(t);
  const browser = await login(api);
  for (const headers of [
    { Cookie: browser.cookie },
    { ...browser.headers, 'X-CSRF-Token': 'incorrect' },
    { ...browser.headers, Origin: 'https://untrusted.example' },
  ]) {
    const denied = await api.request('/admin/api/agents', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'must not exist' }),
    });
    assert.equal(denied.status, 403);
    if ('Origin' in headers && headers.Origin === 'https://untrusted.example')
      assert.match(await denied.text(), /Invalid Origin/i);
    else assert.equal(((await denied.json()) as any).error.code, 'CSRF_REQUIRED');
    assert.equal(denied.headers.get('Set-Cookie'), null, 'a typo must not destroy the session');
  }
  assert.deepEqual((await api.admin('/agents')).agents, []);
  const mixed = await api.request(sessionPath, {
    headers: { Cookie: browser.cookie, Authorization: 'Bearer synthetic-wrangler-oauth' },
  });
  assert.equal(mixed.status, 400);
  await mixed.text();
  const created = await api.request('/admin/api/agents', {
    method: 'POST',
    headers: browser.headers,
    body: JSON.stringify({ name: 'Browser connection' }),
  });
  assert.equal(created.status, 201);
  const data = (await created.json()) as any;
  assert.match(data.access_code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  const listed = await api.admin('/agents');
  assert.equal(listed.agents.length, 1);
  assert(
    !JSON.stringify(listed).includes(data.access_code),
    'listing must not disclose access codes',
  );
});

test('expired CF access tokens renew once across concurrent browser requests', async (t) => {
  const api = await startServer(t);
  api.cloudflare.expiresIn = 3;
  const browser = await login(api);
  api.cloudflare.expiresIn = 3600;
  await delay(Math.max(0, browser.data.expires_at - Date.now()) + 30);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      api.request(sessionPath, { headers: { Cookie: browser.cookie } }),
    ),
  );
  for (const response of responses) {
    assert.equal(response.status, 200, await response.clone().text());
    const next = (await response.json()) as any;
    assert(next.expires_at > browser.data.expires_at);
    assert.equal(next.csrf_token, browser.data.csrf_token);
  }
  assert.equal(refreshCalls(api).length, 1);
  const renewal = refreshCalls(api)[0]!.body;
  assert.equal(renewal.get('refresh_token'), 'synthetic-refresh-1');
  assert.equal(renewal.get('client_id'), 'synthetic-browser-client');
  assert.equal(renewal.get('client_secret'), 'synthetic-secret');
});

test('CF early rejection can renew, temporary failure preserves login, invalid refresh ends it', async (t) => {
  const api = await startServer(t);
  const browser = await login(api);
  api.cloudflare.rejectedTokens.add('synthetic-browser-0');
  api.cloudflare.refreshStatus = 503;
  const unavailable = await api.request(sessionPath, { headers: { Cookie: browser.cookie } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('Set-Cookie'), null);
  await unavailable.text();
  api.cloudflare.refreshStatus = 200;
  const recovered = await api.request(sessionPath, { headers: { Cookie: browser.cookie } });
  assert.equal(recovered.status, 200, await recovered.clone().text());
  await recovered.text();
  assert.equal(refreshCalls(api).length, 2);
  api.cloudflare.rejectedTokens.add('synthetic-browser-1');
  api.cloudflare.refreshStatus = 400;
  const expired = await api.request(sessionPath, { headers: { Cookie: browser.cookie } });
  assert.equal(expired.status, 401);
  assert.match(expired.headers.get('Set-Cookie')!, /Max-Age=0/);
  await expired.text();
  assert.deepEqual(
    refreshCalls(api).map((call) => call.body.get('refresh_token')),
    ['synthetic-refresh-1', 'synthetic-refresh-1', 'synthetic-refresh-2'],
  );
  const count = api.cloudflare.calls.length;
  const stale = await api.request(sessionPath, { headers: { Cookie: browser.cookie } });
  assert.equal(stale.status, 401);
  await stale.text();
  assert.equal(api.cloudflare.calls.length, count);
});

test('logout succeeds while CF is unavailable and removes only that browser session', async (t) => {
  const api = await startServer(t);
  const first = await login(api),
    second = await login(api);
  api.cloudflare.status = 503;
  const before = api.cloudflare.calls.length;
  const response = await api.request('/admin/logout', { method: 'POST', headers: first.headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/);
  assert.equal(api.cloudflare.calls.length, before);
  const old = await api.request(sessionPath, { headers: { Cookie: first.cookie } });
  assert.equal(old.status, 401);
  await old.text();
  api.cloudflare.status = 200;
  const other = await api.request(sessionPath, { headers: { Cookie: second.cookie } });
  assert.equal(other.status, 200);
  await other.text();
});

test('an in-flight CF refresh cannot recreate a logged-out browser session', async (t) => {
  const api = await startServer(t);
  const browser = await login(api);
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  api.cloudflare.rejectedTokens.add('synthetic-browser-0');
  api.cloudflare.beforeRefresh = async () => {
    enter();
    await release;
  };
  t.after(() => resume());
  const waiting = api.request(sessionPath, { headers: { Cookie: browser.cookie } });
  await entered;
  const response = await api.request('/admin/logout', { method: 'POST', headers: browser.headers });
  assert.equal(response.status, 200);
  await response.text();
  resume();
  const renewed = await waiting;
  assert.equal(renewed.status, 401);
  await renewed.text();
  const stale = await api.request(sessionPath, { headers: { Cookie: browser.cookie } });
  assert.equal(stale.status, 401);
  await stale.text();
});
