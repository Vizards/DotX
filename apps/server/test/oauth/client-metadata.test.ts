import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../support/server.ts';
import { beginAuthorization } from '../support/oauth.ts';

const clientId = 'https://client.example/oauth/client.json';
const metadata = {
  client_id: clientId,
  client_name: 'Metadata client',
  redirect_uris: ['https://client.example/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

async function metadataClient(t: TestContext) {
  const api = await startServer(t);
  const upstream: { respond(request: Request): Response | Promise<Response> } = {
    respond: () => Response.json(metadata, { headers: { 'Cache-Control': 'no-store' } }),
  };
  const outgoing = globalThis.fetch;
  // Only the external metadata endpoint is substituted. The OAuth provider,
  // storage, consent, refresh and MCP handlers all run through the real Worker.
  t.mock.method(globalThis, 'fetch', (input: any, init: any) => {
    const request = new Request(input, init);
    return request.url === clientId ? upstream.respond(request) : outgoing(input, init);
  });
  const flow = await beginAuthorization(api.request, ['offline_access'], clientId);
  await api.admin(`/agent-requests/${flow.transaction}/approve`, 'POST', {});
  const approval = await flow.finish();
  assert.equal(approval.status, 303);
  const callback = new URL(approval.headers.get('Location')!);
  const exchange = await flow.exchange(callback);
  assert.equal(exchange.status, 200);
  const { refresh_token } = (await exchange.json()) as { refresh_token: string };
  // Every attempt reuses the originally issued refresh token.
  const refresh = () =>
    api.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token,
        resource: 'http://localhost/mcp',
      }).toString(),
    });
  return { api, upstream, refresh };
}

async function retryable(response: Response) {
  assert.equal(response.status, 503);
  assert.equal(((await response.json()) as any).error, 'temporarily_unavailable');
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('WWW-Authenticate'), null);
}

test('temporary metadata failures allow the original refresh token to recover MCP access', async (t) => {
  const { api, upstream, refresh } = await metadataClient(t);
  const available = upstream.respond;
  for (const status of [408, 429, 503]) {
    upstream.respond = () => new Response(null, { status });
    await retryable(await refresh());
  }

  upstream.respond = (request) =>
    new Promise((_resolve, reject) => {
      // Exercise the provider's actual deadline, without changing its timer.
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (request.signal.aborted) abort();
      else request.signal.addEventListener('abort', abort, { once: true });
    });
  await retryable(await refresh());
  upstream.respond = available;
  const recovered = await refresh();
  assert.equal(recovered.status, 200);
  const renewed = (await recovered.json()) as { access_token: string };
  assert((await api.rpc(renewed.access_token, 'tools/list')).result.tools.length > 0);
});

test('invalid metadata remains an authentication error', async (t) => {
  const { upstream, refresh } = await metadataClient(t);
  upstream.respond = () => new Response('{invalid JSON');
  const rejected = await refresh();
  assert.equal(rejected.status, 401);
  assert.equal(((await rejected.json()) as any).error, 'invalid_client');
  assert.equal(rejected.headers.get('Retry-After'), null);
});
