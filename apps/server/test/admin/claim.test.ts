import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../support/server.ts';
import { cookies } from '../support/browser.ts';

const origin = 'http://localhost';
const post = (
  api: Awaited<ReturnType<typeof startServer>>,
  path: string,
  cookie = '',
  body: unknown = {},
  extra = {},
) =>
  api.request(path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
const read = async (response: Response) => {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<any>;
};
const begin = async (
  api: Awaited<ReturnType<typeof startServer>>,
  cookie = '',
  restart = false,
) => {
  const response = await post(api, '/admin/api/claim/start', cookie, { restart });
  return { data: await read(response), cookie: cookies(response) };
};
const check = (api: Awaited<ReturnType<typeof startServer>>, cookie = '') =>
  post(api, '/admin/api/claim/verify', cookie).then(read);
const password = (api: Awaited<ReturnType<typeof startServer>>, cookie: string, value: unknown) =>
  post(api, '/admin/auth/password/set', cookie, { password: value }, { 'X-DotX-Claim': '1' });

test('claim binds the deployed challenge to its browser, survives deployment, and consumes only on save', async (t) => {
  const api = await startServer(t);
  assert.equal((await check(api)).claim, null);
  const a = await begin(api),
    b = await begin(api);
  assert.equal(a.data.claim.reset, false);
  assert.equal(a.data.claim.verified, false);
  assert.notEqual(a.data.claim.challenge, b.data.claim.challenge);
  assert.equal(a.cookie.includes(a.data.claim.challenge), false);
  assert.equal(a.data.secret_name, 'DOTX_ADMIN_CLAIM');
  assert.match(
    a.data.settings_url,
    /test-account\/workers\/services\/view\/test-worker\/production\/settings#variables$/,
  );
  assert(Math.abs(a.data.claim.expires_at - Date.now() - 24 * 60 * 60 * 1000) < 5000);
  const resumed = await begin(api, a.cookie);
  assert.deepEqual(resumed.data.claim, a.data.claim);
  assert.equal(resumed.cookie, a.cookie);
  assert.equal((await password(api, a.cookie, 'first')).status, 403);
  assert.equal(
    (
      await post(api, '/admin/api/claim/verify', a.cookie, {
        deployedChallenge: a.data.claim.challenge,
      }).then(read)
    ).claim.verified,
    false,
  );
  await api.reload({ adminClaim: a.data.claim.challenge });
  assert.equal((await check(api)).claim, null);
  assert.equal((await check(api, b.cookie)).claim.verified, false);
  const verified = await check(api, a.cookie);
  assert.equal(verified.claim.verified, true);
  assert.equal(verified.claim.expires_at, a.data.claim.expires_at);
  assert.equal(
    (await api.request('/admin/api/devices', { headers: { Cookie: a.cookie } })).status,
    401,
  );
  // A later deployment must not invalidate a previously verified application.
  await api.reload({ adminClaim: b.data.claim.challenge });
  assert.equal((await check(api, a.cookie)).claim.verified, true);
  assert.equal((await check(api, b.cookie)).claim.verified, true);
  assert.equal((await password(api, a.cookie, '')).status, 400);
  assert.equal((await check(api, a.cookie)).claim.verified, true);
  const saved = await password(api, a.cookie, 'first');
  await read(saved);
  const session = await api
    .request('/admin/api/session', { headers: { Cookie: cookies(saved) } })
    .then(read);
  assert.equal(session.qualification, 'browser');
  assert.equal((await password(api, a.cookie, 'replay')).status, 401);
  assert.equal((await password(api, b.cookie, 'stale concurrent request')).status, 401);
  assert.equal((await check(api, a.cookie)).claim, null);
  await api.reload({ adminClaim: a.data.claim.challenge });
  assert.equal((await check(api, a.cookie)).claim, null);
  const next = await begin(api);
  assert.equal(next.data.claim.reset, true);
  assert.equal((await check(api, next.cookie)).claim.verified, false);
});

test('claim recovery preserves old access until save, then revokes old login without changing devices or PA connections', async (t) => {
  const api = await startServer(t);
  const link = await api.admin('/setup', 'POST');
  const initial = await post(
    api,
    '/admin/auth/password/set',
    '',
    { password: 'old' },
    { 'X-DotX-Setup': new URL(link.setup_url).hash.slice(1) },
  );
  await read(initial);
  const oldSession = cookies(initial);
  const device = await api.enroll();
  const agent = await api.authorizeSession();
  const recovery = await begin(api);
  assert.equal(recovery.data.claim.reset, true);
  await api.reload({ adminClaim: recovery.data.claim.challenge });
  assert.equal((await check(api, recovery.cookie)).claim.verified, true);
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: oldSession } })).status,
    200,
  );
  assert.equal((await post(api, '/admin/auth/password', '', { password: 'old' })).status, 200);
  assert.equal((await password(api, recovery.cookie, null)).status, 400);
  const result = await password(api, recovery.cookie, 'new');
  await read(result);
  assert.equal(
    (await api.request('/admin/api/session', { headers: { Cookie: oldSession } })).status,
    401,
  );
  assert.equal((await post(api, '/admin/auth/password', '', { password: 'old' })).status, 401);
  assert.equal((await post(api, '/admin/auth/password', '', { password: 'new' })).status, 200);
  assert.equal((await api.admin('/devices')).devices[0].device_id, device.input.device_id);
  assert.equal((await api.admin('/agents')).agents[0].agent_id, agent.agent_id);
});

test('unmatched and restarted requests cannot reuse a previously written challenge', async (t) => {
  const api = await startServer(t);
  const a = await begin(api);
  await api.reload({ adminClaim: 'a different deployment' });
  assert.deepEqual((await check(api, a.cookie)).claim, a.data.claim);
  const restarted = await begin(api, a.cookie, true);
  assert.notEqual(restarted.cookie, a.cookie);
  assert.notEqual(restarted.data.claim.challenge, a.data.claim.challenge);
  await api.reload({ adminClaim: a.data.claim.challenge });
  assert.equal((await check(api, a.cookie)).claim, null);
  assert.equal((await check(api, restarted.cookie)).claim.verified, false);
  await api.reload({ adminClaim: restarted.data.claim.challenge });
  assert.equal((await check(api, restarted.cookie)).claim.verified, true);
  await api.reload({ adminClaim: '' });
  assert.equal((await check(api, restarted.cookie)).claim.verified, true);
});

test('claim mutations reject other origins and a failed passkey ceremony leaves the application usable', async (t) => {
  const api = await startServer(t);
  for (const path of ['/admin/api/claim/start', '/admin/api/claim/verify']) {
    // Loopback reaches the application; the local harness rejects external Origins itself.
    const rejected = await post(api, path, '', {}, { Origin: 'http://127.0.0.1' });
    assert.equal(rejected.status, 403);
    assert.equal(((await rejected.json()) as any).error.code, 'BAD_ORIGIN');
    assert.equal((await api.request(path)).status, 405);
  }
  const a = await begin(api);
  const options = () =>
    post(api, '/admin/auth/passkey/register/options', a.cookie, {}, { 'X-DotX-Claim': '1' });
  assert.equal((await options()).status, 403);
  await api.reload({ adminClaim: a.data.claim.challenge });
  await check(api, a.cookie);
  const ceremony = await options();
  const first = await read(ceremony);
  const invalid = await post(
    api,
    '/admin/auth/passkey/register/verify',
    a.cookie + '; ' + cookies(ceremony),
    { response: {} },
    { 'X-DotX-Claim': '1' },
  );
  assert.equal(invalid.status, 400);
  const second = await options().then(read);
  assert.notEqual(second.challenge, first.challenge);
  assert.equal((await check(api, a.cookie)).claim.verified, true);
  assert.equal((await password(api, a.cookie, 'fallback')).status, 200);
});

test('claim tolerates surrounding whitespace but rejects changed values without disclosing them', async (t) => {
  const api = await startServer(t);
  const request = await begin(api);
  const challenge = request.data.claim.challenge;
  for (const [value, issue] of [
    [` \nDOTX_ADMIN_CLAIM=${challenge}\r\n`, 'name_in_value'],
    [challenge.slice(0, 10) + ' ' + challenge.slice(10), null],
    [challenge.slice(0, 10) + '\n' + challenge.slice(10), null],
    [' \t\r\n', null],
  ] as const) {
    await api.reload({ adminClaim: value });
    const result = await check(api, request.cookie);
    assert.equal(result.claim.verified, false);
    assert.equal(result.value_format_issue, issue);
    assert.equal(result.secret_present, !!value.trim());
    assert.equal(JSON.stringify(await check(api)).includes(challenge), false);
  }
  await api.reload({ adminClaim: ` \t\r\n\u00a0${challenge}\u00a0\r\n\t ` });
  const verified = await check(api, request.cookie);
  assert.equal(verified.claim.verified, true);
  assert.equal(verified.value_format_issue, null);
  assert.equal(JSON.stringify(await check(api)).includes(challenge), false);
});

test(
  'claim creation has an atomic shared budget without blocking existing requests or login',
  { timeout: 90_000 },
  async (t) => {
    const api = await startServer(t);
    const first = await begin(api);
    const restarted = await begin(api, first.cookie, true);
    assert.equal((await check(api, first.cookie)).claim, null);
    const batch = await Promise.all(
      Array.from({ length: 18 }, () => post(api, '/admin/api/claim/start')),
    );
    assert.equal(batch.filter((r) => r.status === 200).length, 8);
    assert.equal(batch.filter((r) => r.status === 429).length, 10);
    for (const response of batch) {
      const result = (await response.json()) as any;
      if (response.status === 429) {
        assert.equal(result.error.code, 'CLAIM_ATTEMPTS_EXHAUSTED');
        assert.equal(response.headers.has('Set-Cookie'), false);
      }
    }
    const resumed = await begin(api, restarted.cookie);
    assert.deepEqual(resumed.data.claim, restarted.data.claim);
    const rejected = await post(api, '/admin/api/claim/start', restarted.cookie, { restart: true });
    assert.equal(rejected.status, 429);
    const limited = (await rejected.json()) as any;
    const seconds = limited.error.details.retry_after_seconds;
    assert(seconds > 0 && seconds <= 60);
    assert.deepEqual((await check(api, restarted.cookie)).claim, restarted.data.claim);
    await api.reload({ adminClaim: restarted.data.claim.challenge });
    assert.equal(
      (await post(api, '/admin/api/claim/start')).status,
      429,
      'deployment does not reset the budget',
    );
    assert.equal((await check(api, restarted.cookie)).claim.verified, true);
    const saved = await password(api, restarted.cookie, 'current');
    assert.equal(saved.status, 200);
    await saved.text();
    assert.equal(
      (await post(api, '/admin/api/claim/start')).status,
      429,
      'saving credentials does not reset the budget',
    );
    const login = await post(api, '/admin/auth/password', '', { password: 'current' });
    assert.equal(login.status, 200, 'claim creation does not consume login attempts');
    await login.text();
    for (let i = 0; i < 9; i++)
      assert.equal(
        (await post(api, '/admin/auth/password', '', { password: 'wrong' })).status,
        401,
      );
    const loginLimited = await post(api, '/admin/auth/password', '', { password: 'current' });
    assert.equal(loginLimited.status, 429);
  },
);

test(
  'claim and login budgets recover after their fixed windows',
  { timeout: 90_000 },
  async (t) => {
    // Exercise the two budgets independently, including late rejected attempts.
    const claimApi = await startServer(t);
    const loginApi = await startServer(t);
    const setup = await loginApi.admin('/setup', 'POST');
    await read(
      await post(
        loginApi,
        '/admin/auth/password/set',
        '',
        { password: 'current' },
        {
          'X-DotX-Setup': new URL(setup.setup_url).hash.slice(1),
        },
      ),
    );
    const create = () => post(claimApi, '/admin/api/claim/start');
    const login = (password = 'wrong') => post(loginApi, '/admin/auth/password', '', { password });
    for (let i = 0; i < 10; i++) {
      assert.equal((await create()).status, 200);
      assert.equal((await login()).status, 401);
    }
    const retryAt = async (response: Response) => {
      assert.equal(response.status, 429);
      const seconds = ((await response.json()) as any).error.details.retry_after_seconds;
      assert(seconds > 0 && seconds <= 60);
      return Date.now() + seconds * 1000;
    };
    const claimRetryAt = await retryAt(await create());
    const loginRetryAt = await retryAt(await login());
    // Late rejected attempts must not restart either fixed window.
    await delay(2_100);
    assert((await retryAt(await create())) <= claimRetryAt + 1_000);
    assert((await retryAt(await login())) <= loginRetryAt + 1_000);
    await delay(Math.max(0, Math.max(claimRetryAt, loginRetryAt) - Date.now()) + 50);
    assert.equal((await create()).status, 200, 'Claim creation resumes after the original window');
    assert.equal(
      (await login('current')).status,
      200,
      'login resumes after its independent window',
    );
  },
);
