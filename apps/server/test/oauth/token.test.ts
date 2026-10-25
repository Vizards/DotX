import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../support/server.ts';
import { beginAuthorization } from '../support/oauth.ts';

test('OAuth integration requires registered redirects and S256 PKCE, and rejects code replay', async (t) => {
  const api = await startServer(t);
  const flow = await beginAuthorization(api.request);
  for (const changes of [
    { redirect_uri: 'https://untrusted.example/callback' },
    { code_challenge_method: 'plain' },
  ]) {
    const query = new URLSearchParams(flow.query);
    for (const [name, value] of Object.entries(changes)) query.set(name, value);
    const invalid = await api.request('/authorize?' + query);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('Location'), null);
    await invalid.text();
  }
  const invitation = await api.admin('/agents', 'POST', { name: 'PKCE' });
  const approval = await flow.approve(invitation.access_code);
  const callback = new URL(approval.headers.get('Location')!);
  const wrong = await flow.exchange(callback, { code_verifier: 'a'.repeat(64) });
  assert.equal(wrong.status, 400);
  assert.equal(((await wrong.json()) as any).error, 'invalid_grant');
  const fresh = await beginAuthorization(api.request);
  const nextCode = await api.admin(
    `/agents/${invitation.connection.agent_id}/enrollment-code`,
    'POST',
  );
  const next = await fresh.approve(nextCode.access_code);
  const nextCallback = new URL(next.headers.get('Location')!);
  const granted = await fresh.exchange(nextCallback);
  assert.equal(granted.status, 200);
  const token = ((await granted.json()) as any).access_token;
  assert((await api.rpc(token, 'tools/list')).result.tools.length > 0);
  const replay = await fresh.exchange(nextCallback);
  assert.equal(replay.status, 400);
  assert.equal(((await replay.json()) as any).error, 'invalid_grant');
  // The installed provider revokes tokens issued from a replayed authorization code.
  const revoked = await api.request('/mcp', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(revoked.status, 401);
  await revoked.text();
});
