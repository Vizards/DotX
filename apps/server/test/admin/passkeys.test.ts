import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { test } from 'node:test';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { startServer } from '../support/server.ts';
import { cookies } from '../support/browser.ts';

// A protocol peer with a real key and signatures, not a stubbed verifier or
// injected database record. Physical authenticator UX is checked separately.
test('Passkey rename requires browser authority, changes only the label, and preserves login', async (t) => {
  const api = await startServer(t);
  const origin = 'http://localhost';
  const read = async (response: Response) => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<any>;
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    api.request(path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credential = randomBytes(32);
  const id = credential.toString('base64url');
  const rpHash = createHash('sha256').update('localhost').digest();
  const clientData = (type: string, challenge: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const setup = await api.admin('/setup', 'POST');
  const setupHeader = { 'X-DotX-Setup': new URL(setup.setup_url).hash.slice(1) };
  const registration = await post('/admin/auth/passkey/register/options', {}, setupHeader);
  const options = await read(registration);
  const publicKeyCbor = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  );
  const authData = Buffer.concat([
    rpHash,
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([0, credential.length]),
    credential,
    publicKeyCbor,
  ]);
  const registered = await post(
    '/admin/auth/passkey/register/verify',
    {
      name: 'Original key',
      response: {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData('webauthn.create', options.challenge).toString('base64url'),
          attestationObject: Buffer.from(
            isoCBOR.encode(
              new Map<string, string | Map<string, never> | Uint8Array>([
                ['fmt', 'none'],
                ['attStmt', new Map<string, never>()],
                ['authData', authData],
              ]),
            ),
          ).toString('base64url'),
          transports: ['internal'],
        },
      },
    },
    { ...setupHeader, Cookie: cookies(registration) },
  );
  await read(registered);
  const cookie = cookies(registered);
  const session = await api
    .request('/admin/api/session', { headers: { Cookie: cookie } })
    .then(read);
  const headers = {
    Cookie: cookie,
    Origin: origin,
    'X-CSRF-Token': session.csrf_token,
    'Content-Type': 'application/json',
  };
  const security = () =>
    api.request('/admin/api/security', { headers: { Cookie: cookie } }).then(read);
  const before = await security();
  const rename = (body: unknown, auth: Record<string, string> = headers, keyId = id) =>
    api.request('/admin/api/passkeys/' + keyId, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify(body),
    });
  assert.equal((await rename({ name: 'No session' }, { Origin: origin })).status, 401);
  assert.equal((await rename({ name: 'No CSRF' }, { Cookie: cookie, Origin: origin })).status, 403);
  assert.equal((await rename({ name: 'Unknown' }, headers, 'missing-key')).status, 404);
  for (const body of [null, {}, { name: 7 }, { name: '   ' }])
    assert.equal((await rename(body)).status, 400);
  assert.deepEqual(await security(), before);
  const result = await read(await rename({ name: '  My laptop  ' }));
  assert.deepEqual(result.passkeys, [{ ...before.passkeys[0], name: 'My laptop' }]);
  assert.deepEqual(
    (await security()).passkeys,
    result.passkeys,
    'the same session survives rename',
  );

  const loginOptionsResponse = await post('/admin/auth/passkey/options', {});
  const loginOptions = await read(loginOptionsResponse);
  const data = clientData('webauthn.get', loginOptions.challenge);
  const assertion = Buffer.concat([rpHash, Buffer.from([5]), Buffer.from([0, 0, 0, 1])]);
  const signature = sign(
    'sha256',
    Buffer.concat([assertion, createHash('sha256').update(data).digest()]),
    privateKey,
  );
  const login = await post(
    '/admin/auth/passkey/verify',
    {
      response: {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: data.toString('base64url'),
          authenticatorData: assertion.toString('base64url'),
          signature: signature.toString('base64url'),
          userHandle: options.user.id,
        },
      },
    },
    { Cookie: cookies(loginOptionsResponse) },
  );
  await read(login);
  const authenticated = await api
    .request('/admin/api/security', { headers: { Cookie: cookies(login) } })
    .then(read);
  assert.equal(authenticated.passkeys[0].name, 'My laptop');
});
