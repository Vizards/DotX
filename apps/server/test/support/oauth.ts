import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cookies } from './browser.ts';
import type { createTestHarness } from 'wrangler';
type Fetch = ReturnType<typeof createTestHarness>['fetch'];

// A protocol client, not a simulation of Cue/ChatGPT or their browser behavior.
export async function beginAuthorization(
  request: (path: string, init?: Parameters<Fetch>[1]) => Promise<Response>,
  scopes?: string[],
) {
  const registration = await request('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'DotX API test',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(registration.status, 201);
  const { client_id } = (await registration.json()) as { client_id: string };
  const verifier = randomUUID() + randomUUID();
  const query = new URLSearchParams({
    client_id,
    redirect_uri: 'https://client.example/callback',
    response_type: 'code',
    ...(scopes ? { scope: scopes.join(' ') } : {}),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: 'http://localhost/mcp',
    state: randomUUID(),
  });
  const response = await request('/authorize?' + query);
  assert.equal(response.status, 303, await response.clone().text());
  const transaction = new URL(
    response.headers.get('Location')!,
    'http://localhost',
  ).searchParams.get('transaction')!;
  const cookie = cookies(response);
  const headers = {
    Cookie: cookie,
    Origin: 'http://localhost',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const form = (decision = 'finish') => new URLSearchParams({ transaction, decision }).toString();
  return {
    client_id,
    query,
    transaction,
    cookie,
    headers,
    form,
    finish: (json = false) =>
      request('/authorize', {
        method: 'POST',
        headers: { ...headers, ...(json ? { Accept: 'application/json' } : {}) },
        body: form(),
      }),
    exchange: (callback: URL, overrides: Record<string, string> = {}) =>
      request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id,
          code: callback.searchParams.get('code')!,
          code_verifier: verifier,
          redirect_uri: query.get('redirect_uri')!,
          resource: query.get('resource')!,
          ...(scopes ? { scope: scopes.join(' ') } : {}),
          ...overrides,
        }).toString(),
      }),
  };
}
