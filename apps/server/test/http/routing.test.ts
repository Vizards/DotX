import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../support/server.ts';

async function routingServer(t: TestContext, publicOrigin?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'dotx-routing-'));
  // These files test HTTP dispatch only, not React rendering or its build output.
  await cp(fileURLToPath(new URL('../../public', import.meta.url).href), directory, {
    recursive: true,
  });
  await mkdir(join(directory, 'assets'));
  await mkdir(join(directory, 'api'));
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><html><body>routing-shell</body></html>',
  );
  await writeFile(join(directory, 'assets', 'app.js'), '/* routing-script */');
  await writeFile(join(directory, 'api', 'shadow.json'), '{"mustNotBeServed":true}');
  const api = await startServer(t, 'list', { assetsDirectory: directory, publicOrigin });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return api;
}

test('HTTP routes serve declared pages but never return the SPA for API or unknown paths', async (t) => {
  const api = await routingServer(t);
  const root = await api.fetch('http://localhost/', { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('Location'), '/admin');
  await root.text();
  for (const path of [
    '/admin',
    '/admin/agents',
    '/admin/devices/',
    '/authorize?transaction=synthetic',
  ]) {
    const page = await api.fetch('http://localhost' + path);
    assert.equal(page.status, 200, path);
    assert.match(page.headers.get('Content-Type')!, /text\/html/);
    assert.equal(page.headers.get('Cache-Control'), 'no-store');
    assert.match(page.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
    assert.match(await page.text(), /routing-shell/);
  }
  for (const [path, status] of [
    ['/admin/api/unknown', 401],
    ['/mcp', 401],
    ['/oauth/unknown', 404],
    ['/api/unknown', 404],
    ['/api/shadow.json', 404],
    ['/admin/not-a-page', 404],
    ['/unknown', 404],
    ['/index.html', 404],
    ['/_headers', 404],
  ] as const) {
    const response = await api.fetch('http://localhost' + path, {
      redirect: 'manual',
      headers: { Accept: 'text/html' },
    });
    assert.equal(response.status, status, path);
    assert.doesNotMatch(response.headers.get('Content-Type') ?? '', /text\/html/);
    assert.doesNotMatch(await response.text(), /routing-shell|mustNotBeServed/);
  }
  const authenticatedUnknown = await api.fetch('http://localhost/admin/api/unknown', {
    headers: { Authorization: 'Bearer synthetic-wrangler-oauth', Accept: 'text/html' },
  });
  assert.equal(authenticatedUnknown.status, 404);
  assert.match(authenticatedUnknown.headers.get('Content-Type')!, /application\/json/);
  await authenticatedUnknown.text();
  const invalidToken = await api.fetch('http://localhost/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
    body: 'grant_type=authorization_code&code=not-issued&client_id=not-registered',
  });
  assert(invalidToken.status >= 400 && invalidToken.status < 500);
  assert.match(invalidToken.headers.get('Content-Type')!, /application\/json/);
  await invalidToken.text();
});

test('public asset routes bypass Worker execution and retain static headers and missing-file 404s', async (t) => {
  // Every executed production Worker request must now fail its origin check.
  // Static success therefore proves routing bypass without a test Worker or probe.
  const api = await routingServer(t, 'https://different-origin.example');
  const dynamic = await api.fetch('http://localhost/health');
  assert.equal(dynamic.status, 421);
  await dynamic.text();
  for (const path of ['/assets/app.js', '/branding/icon.png', '/branding/metadata.json']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await api.fetch('http://localhost' + path, { method });
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
      const body = await response.text();
      if (method === 'HEAD') assert.equal(body, '');
    }
  }
  for (const path of ['/assets/missing.js', '/branding/missing.png']) {
    const missing = await api.fetch('http://localhost' + path, {
      headers: { Accept: 'text/html' },
    });
    assert.equal(missing.status, 404, path);
    assert.doesNotMatch(await missing.text(), /routing-shell/);
  }
});
