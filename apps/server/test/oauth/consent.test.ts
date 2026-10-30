import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../support/server.ts';
import { beginAuthorization } from '../support/oauth.ts';
import { cookies } from '../support/browser.ts';

test('Wrangler approval works without browser login, but only the original browser can finish OAuth', async (t) => {
  const api = await startServer(t);
  const flow = await beginAuthorization(api.request);
  const contextPath = '/oauth/consent?transaction=' + flow.transaction;
  const context = await api.request(contextPath, { headers: { Cookie: flow.cookie } });
  assert.equal(context.status, 200);
  assert.equal(((await context.json()) as any).phase, 'waiting');
  assert.equal((await api.admin('/agents')).agents.length, 0);
  assert.equal((await api.admin('/setup')).configured, false);
  assert.equal((await flow.finish(true)).status, 409);
  const path = `/admin/api/agent-requests/${flow.transaction}/approve`;
  assert.equal((await api.request(path, { method: 'POST', body: '{}' })).status, 401);
  const approval = await api.admin(`/agent-requests/${flow.transaction}/approve`, 'POST', {});
  assert(approval.agent_id);
  assert(!JSON.stringify(approval).includes('binding'));
  assert(!JSON.stringify(approval).includes('code_challenge'));
  assert(!JSON.stringify(approval).includes('redirectTo'));
  const waiting = (await api.admin('/agents')).agents[0];
  assert.equal(waiting.active, null);
  assert.equal(waiting.pending.phase, 'authorizing');
  for (const headers of [
    { ...flow.headers, Cookie: 'dotx-consent=wrong' },
    { ...flow.headers, Origin: 'https://untrusted.example' },
  ]) {
    const denied = await api.request('/authorize', { method: 'POST', headers, body: flow.form() });
    assert([400, 403].includes(denied.status));
    await denied.text();
  }
  assert.equal((await api.request(contextPath)).status, 400);
  const approved = await api.request(contextPath, { headers: { Cookie: flow.cookie } });
  assert.equal(((await approved.json()) as any).phase, 'approved');
  const finished = await flow.finish(true);
  assert.equal(finished.status, 200, await finished.clone().text());
  const callback = new URL(((await finished.json()) as any).redirect);
  assert.equal(callback.searchParams.get('state'), flow.query.get('state'));
  // Reload/retry before callback can recover the same redirect without issuing a second code.
  const repeat = await flow.finish(true);
  assert.equal(((await repeat.json()) as any).redirect, callback.href);
  const tokens = await flow.exchange(callback);
  assert.equal(tokens.status, 200);
  const token = ((await tokens.json()) as any).access_token;
  assert.equal((await api.admin('/agents')).agents[0].active, null);
  assert((await api.rpc(token, 'tools/list')).result.tools.length > 0);
  assert((await api.admin('/agents')).agents[0].active);
});

test('browser login or first setup does not approve the PA; approval requires an authenticated CSRF-protected action', async (t) => {
  const api = await startServer(t);
  const flow = await beginAuthorization(api.request);
  const setup = await api.admin('/setup', 'POST');
  const login = await api.request('/admin/auth/password/set', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      'Content-Type': 'application/json',
      'X-DotX-Setup': new URL(setup.setup_url).hash.slice(1),
    },
    body: JSON.stringify({ password: 'test' }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  const sessionCookie = cookies(login);
  const session = await api.request('/admin/api/session', { headers: { Cookie: sessionCookie } });
  const csrf = ((await session.json()) as any).csrf_token;
  assert.equal((await api.admin('/agents')).agents.length, 0);
  assert.equal((await flow.finish(true)).status, 409);
  const url = `/admin/api/agent-requests/${flow.transaction}/approve`;
  for (const headers of [
    { Cookie: sessionCookie, Origin: 'http://localhost' },
    { Cookie: sessionCookie, Origin: 'https://bad.example', 'X-CSRF-Token': csrf },
  ]) {
    assert.equal((await api.request(url, { method: 'POST', headers, body: '{}' })).status, 403);
  }
  const response = await api.request(url, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      Origin: 'http://localhost',
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await flow.finish()).status, 303);
});

test('rejecting or cancelling returns access_denied and never creates an active connection', async (t) => {
  const api = await startServer(t);
  for (const remote of [true, false]) {
    const flow = await beginAuthorization(api.request);
    if (remote) await api.admin(`/agent-requests/${flow.transaction}/reject`, 'POST');
    const cancelled = await api.request('/authorize', {
      method: 'POST',
      headers: flow.headers,
      body: flow.form('deny'),
    });
    assert.equal(cancelled.status, 303);
    const location = new URL(cancelled.headers.get('Location')!);
    assert.equal(location.searchParams.get('error'), 'access_denied');
    assert.equal(location.searchParams.get('state'), flow.query.get('state'));
    assert.equal((await flow.finish(true)).status, 409);
  }
  assert.deepEqual((await api.admin('/agents')).agents, []);
  assert.deepEqual((await api.admin('/agent-requests')).requests, []);
});
