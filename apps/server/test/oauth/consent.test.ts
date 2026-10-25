import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../support/server.ts';
import { beginAuthorization } from '../support/oauth.ts';

test('consent binds the browser and allows two wrong codes followed by an immediate correct attempt', async (t) => {
  const api = await startServer(t);
  const invitation = await api.admin('/agents', 'POST', { name: 'OAuth client' });
  const flow = await beginAuthorization(api.request);
  const context = await api.request('/oauth/consent?transaction=' + flow.transaction, {
    headers: { Cookie: flow.cookie },
  });
  assert.equal(context.status, 200);
  assert.equal(((await context.json()) as any).client_name, 'DotX API test');
  for (const headers of [
    { ...flow.headers, Cookie: 'dotx-consent=another-browser' },
    { ...flow.headers, Origin: 'https://untrusted.example' },
  ]) {
    const denied = await api.request('/authorize', {
      method: 'POST',
      headers,
      body: flow.form(invitation.access_code),
    });
    assert([400, 403].includes(denied.status));
    await denied.text();
  }
  const first = await flow.approve('000000');
  assert.equal(first.status, 303);
  assert.equal(first.headers.get('Location'), '/authorize?transaction=' + flow.transaction);
  const errorContext = await api.request('/oauth/consent?transaction=' + flow.transaction, {
    headers: { Cookie: flow.cookie },
  });
  assert.equal(((await errorContext.json()) as any).error.code, 'ACCESS_CODE_INVALID');
  const second = await flow.approve('000001', true);
  assert.equal(second.status, 400);
  assert.equal(((await second.json()) as any).error.code, 'ACCESS_CODE_INVALID');
  const correct = await flow.approve(' ' + invitation.access_code.toLowerCase() + ' ', true);
  assert.equal(correct.status, 200, await correct.clone().text());
  const callback = new URL(((await correct.json()) as any).redirect);
  assert.equal(callback.searchParams.get('state'), flow.query.get('state'));
  const tokens = await flow.exchange(callback);
  assert.equal(tokens.status, 200);
  const token = ((await tokens.json()) as any).access_token;
  assert((await api.rpc(token, 'tools/list')).result.tools.length > 0);
});

test(
  'access-code attempts share a ten-per-minute budget and recover after the original window',
  { timeout: 90_000 },
  async (t) => {
    const api = await startServer(t);
    const invitation = await api.admin('/agents', 'POST', { name: 'After budget reset' });
    const flow = await beginAuthorization(api.request);
    const before = Date.now();
    for (let i = 0; i < 10; i++) {
      const response = await flow.approve('000000', true);
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as any).error.code, 'ACCESS_CODE_INVALID');
    }
    const limited = await flow.approve(invitation.access_code, true);
    assert.equal(limited.status, 429);
    const limit = (await limited.json()) as any;
    assert.equal(limit.error.code, 'ACCESS_CODE_ATTEMPTS_EXCEEDED');
    const retryAt = limit.error.details.retry_at;
    assert(retryAt >= before + 60_000 && retryAt <= Date.now() + 60_000);
    const other = await beginAuthorization(api.request);
    const alsoLimited = await other.approve(invitation.access_code, true);
    assert.equal(alsoLimited.status, 429);
    assert.equal(
      ((await alsoLimited.json()) as any).error.details.retry_at,
      retryAt,
      'new transactions and failed retries must not bypass or extend the same window',
    );
    await delay(Math.max(0, retryAt - Date.now()) + 50);
    const restored = await flow.approve(invitation.access_code);
    assert.equal(restored.status, 303, await restored.clone().text());
    const tokens = await flow.exchange(new URL(restored.headers.get('Location')!));
    assert.equal(tokens.status, 200);
    await tokens.text();
  },
);

test('cancelling consent returns the client state and leaves the unused invitation available', async (t) => {
  const api = await startServer(t);
  const invitation = await api.admin('/agents', 'POST', { name: 'Later' });
  const flow = await beginAuthorization(api.request);
  const cancelled = await api.request('/authorize', {
    method: 'POST',
    headers: flow.headers,
    body: flow.form('', 'deny'),
  });
  assert.equal(cancelled.status, 303);
  const location = new URL(cancelled.headers.get('Location')!);
  assert.equal(location.searchParams.get('error'), 'access_denied');
  assert.equal(location.searchParams.get('state'), flow.query.get('state'));
  const old = await flow.approve(invitation.access_code, true);
  assert.equal(old.status, 400);
  assert.equal(((await old.json()) as any).error.code, 'AUTHORIZATION_CANCELLED');
  const restarted = await beginAuthorization(api.request);
  const approval = await restarted.approve(invitation.access_code);
  assert.equal(approval.status, 303);
  assert(new URL(approval.headers.get('Location')!).searchParams.has('code'));
});
