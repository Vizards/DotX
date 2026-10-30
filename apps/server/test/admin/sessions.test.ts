import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../support/server.ts';
import { cookies } from '../support/browser.ts';

test('nearby reads share the session expiry; logout immediately rejects further reads and writes', async (t) => {
  const api = await startServer(t);
  const setup = await api.admin('/setup', 'POST');
  const login = await api.request('/admin/auth/password/set', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      'Content-Type': 'application/json',
      'X-DotX-Setup': new URL(setup.setup_url).hash.slice(1),
    },
    body: JSON.stringify({ password: 'synthetic-password' }),
  });
  assert.equal(login.status, 200, await login.text());
  const headers = { Cookie: cookies(login) };
  const session = () => api.request('/admin/api/session', { headers });
  const initial = (await (await session()).json()) as any;
  for (const path of ['/devices', '/device-requests', '/agents', '/agent-requests']) {
    const response = await api.request('/admin/api' + path, { headers });
    assert.equal(response.status, 200, await response.text());
  }
  const response = await session();
  const latest = (await response.json()) as any;
  assert.equal(latest.expires_at, initial.expires_at);
  const maxAge = Number(/Max-Age=(\d+)/.exec(response.headers.get('Set-Cookie')!)?.[1]);
  assert(Math.abs(Date.now() + maxAge * 1000 - latest.expires_at) < 2000);
  const logout = await api.request('/admin/logout', {
    method: 'POST',
    headers: { ...headers, Origin: 'http://localhost', 'X-CSRF-Token': latest.csrf_token },
  });
  assert.equal(logout.status, 200, await logout.text());
  const revoked = await session();
  assert.equal(revoked.status, 401);
  await revoked.text();
  const device = await api.enroll(false);
  const write = await api.request(
    '/admin/api/device-requests/' + device.input.operation_id + '/approve',
    {
      method: 'POST',
      headers: { ...headers, Origin: 'http://localhost', 'X-CSRF-Token': latest.csrf_token },
    },
  );
  assert.equal(write.status, 401);
  await write.text();
});
