import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Enrollment } from '../src/enrollment/service.ts';
import { sha256 } from '../src/auth/credentials.ts';
import { MemoryStore } from './fixtures/store.ts';

const origin = 'https://setup.example.com';
async function fixture() {
  const store = new MemoryStore(),
    admin = 'owner-secret';
  const enrollment = new Enrollment(store, await sha256(admin), origin);
  const input = {
    operation_id: randomUUID(),
    device_id: randomUUID(),
    label: 'Synthetic Mac',
    token_hash: await sha256('device-secret'),
    claim_hash: await sha256('claim-secret'),
  };
  const call = (
    route: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) =>
    enrollment.fetch(
      new Request(origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { store, admin, enrollment, input, call };
}
test('enrollment retry, concurrent approvals and lost response preserve exactly one device', async () => {
  const f = await fixture();
  await Promise.all([f.enrollment.request(f.input), f.enrollment.request(f.input)]);
  assert.equal((await f.enrollment.devices()).length, 0);
  const denied = await f.call(
    '/setup/approve',
    { operation_id: f.input.operation_id },
    'device-secret',
  );
  assert.equal(denied.status, 401);
  await Promise.all([
    f.enrollment.approve(f.input.operation_id),
    f.enrollment.approve(f.input.operation_id),
  ]);
  assert.equal((await f.enrollment.devices()).length, 1);
  // New instance simulates DO restart after the approval response was lost.
  const restored = new Enrollment(f.store, await sha256(f.admin), origin);
  assert.deepEqual(await restored.status(f.input.operation_id, 'claim-secret'), {
    approved: true,
    device_id: f.input.device_id,
  });
  assert.equal((await restored.request(f.input)).approved, true);
  await assert.rejects(restored.request({ ...f.input, label: 'Changed' }), /ENROLLMENT_CONFLICT/);
  await assert.rejects(
    restored.status(f.input.operation_id, 'device-secret'),
    /ENROLLMENT_NOT_FOUND/,
  );
});
test('expired pairing cannot authorize a new identity and competing enrollment cannot replace credentials', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const f = await fixture();
  await f.enrollment.request(f.input);
  t.mock.timers.tick(15 * 60_000);
  await assert.rejects(f.enrollment.approve(f.input.operation_id), /ENROLLMENT_EXPIRED/);
  const replacement = { ...f.input, operation_id: randomUUID() };
  await f.enrollment.request(replacement);
  await f.enrollment.approve(replacement.operation_id);
  await assert.rejects(
    f.enrollment.request({
      ...replacement,
      operation_id: randomUUID(),
      token_hash: await sha256('another-token'),
    }),
    /DEVICE_ID_CONFLICT/,
  );
  t.mock.timers.tick(15 * 60_000);
  assert.equal(
    (await f.enrollment.status(replacement.operation_id, 'claim-secret')).approved,
    true,
  );
});
test('owner revocation removes the device and old approval without touching other devices', async () => {
  const f = await fixture();
  await f.enrollment.request(f.input);
  await f.enrollment.approve(f.input.operation_id);
  const other = { ...f.input, device_id: randomUUID(), operation_id: randomUUID() };
  await f.enrollment.request(other);
  await f.enrollment.approve(other.operation_id);
  const body = { device_id: f.input.device_id };
  assert.equal((await f.call('/setup/revoke', body, 'device-secret')).status, 401);
  assert.equal((await f.call('/setup/revoke', body, f.admin, { Origin: 'null' })).status, 403);
  assert.equal((await f.call('/setup/revoke', body, f.admin)).status, 200);
  assert.deepEqual(
    (await f.enrollment.devices()).map((d) => d.id),
    [other.device_id],
  );
  await assert.rejects(
    f.enrollment.status(f.input.operation_id, 'claim-secret'),
    /ENROLLMENT_NOT_FOUND/,
  );
  await assert.rejects(f.enrollment.approve(f.input.operation_id), /ENROLLMENT_EXPIRED/);
  assert.equal((await f.call('/setup/revoke', body, f.admin)).status, 200);
  assert.equal((await f.enrollment.request(f.input)).approved, false);
});
test('browser login is one use, expires, and CSRF cannot approve a pending device', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const f = await fixture();
  assert.equal((await f.call('/setup/browser', {}, 'device-secret')).status, 401);
  const login = (await (await f.call('/setup/browser', {}, f.admin)).json()) as { url: string };
  const result = await f.enrollment.fetch(new Request(login.url));
  assert.equal(result.status, 303);
  const cookie = result.headers.get('Set-Cookie')!;
  assert(
    cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'),
  );
  assert.equal((await f.enrollment.fetch(new Request(login.url))).status, 400);
  await f.enrollment.request(f.input);
  const pairPage = await f.enrollment.fetch(
    new Request(origin + '/setup/pair/' + f.input.operation_id, { headers: { Cookie: cookie } }),
  );
  assert.equal(pairPage.headers.get('Referrer-Policy'), 'same-origin');
  assert.match(await pairPage.text(), /method="post" action="\/setup\/approve"/);
  assert.equal(
    (
      await f.call('/setup/approve', { operation_id: f.input.operation_id }, undefined, {
        Cookie: cookie,
        Origin: 'null',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call('/setup/approve', { operation_id: f.input.operation_id }, undefined, {
        Cookie: cookie,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call('/setup/approve', { operation_id: f.input.operation_id }, undefined, {
        Cookie: cookie,
        Origin: 'https://evil.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call('/setup/approve', { operation_id: f.input.operation_id }, undefined, {
        Cookie: cookie,
        Origin: origin,
      })
    ).status,
    200,
  );
  const rotated = new Enrollment(f.store, await sha256('new-owner'), origin);
  assert.equal(await rotated.browser(new Request(origin, { headers: { Cookie: cookie } })), false);
  t.mock.timers.tick(3600_000);
  assert.equal(
    await f.enrollment.browser(new Request(origin, { headers: { Cookie: cookie } })),
    false,
  );
});

// Discovery is public and independent of a ChatGPT installation or an online Mac.
test('service discovery requires no stored plugin binding; the old binding endpoint is absent', async () => {
  const f = await fixture();
  const expected = { product: 'dotx', setup_protocol: 1, origin };
  assert.deepEqual(await (await f.call('/setup/info')).json(), expected);
  assert.deepEqual(await f.enrollment.devices(), []);
  assert.equal((await f.call('/setup/plugin', {}, f.admin)).status, 404);
  const restarted = new Enrollment(f.store, await sha256(f.admin), origin);
  assert.deepEqual(await restarted.info(), expected);
});
