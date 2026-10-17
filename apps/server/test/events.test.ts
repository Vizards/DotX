import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { Events } from '../src/events/subscriptions.ts';
import { callbackURL, sign, secretBytes, responseDiagnostic } from '../src/events/webhook.ts';
import { matchesEvent } from '@dotx/shared/events';
import type { Notice } from '@dotx/shared/events';
import { MemoryStore } from './fixtures/store.ts';
import { serveMcp } from '../src/mcp/server.ts';
import { MCP_PROTOCOL_VERSION } from '@dotx/shared/protocol';

const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const auth = { principal: 'grant-a', devices: ['mini'] };
test('callback diagnostics classify failures without exposing response content', async () => {
  const result = await responseDiagnostic(
    new Response('<html>Just a moment cf-chl-secret</html>', {
      status: 403,
      headers: { 'content-type': 'text/html', 'cf-ray': 'abc-LAX', 'x-request-id': 'unsafe value' },
    }),
  );
  assert.deepEqual(result, {
    date: undefined,
    clock_skew_ms: undefined,
    retry_after_seconds: undefined,
    body_prefix_sha256: createHash('sha256')
      .update('<html>Just a moment cf-chl-secret</html>')
      .digest('hex'),
    body_prefix_bytes: 40,
    reported_client_ip: undefined,
    category: 'edge_challenge',
    edge_error_code: undefined,
    content_type: 'text/html',
    edge_id: 'abc-LAX',
    request_id: undefined,
    server: undefined,
    edge_error_type: undefined,
    edge_error_origin: undefined,
    edge_mitigated: undefined,
    callback_jurisdiction: undefined,
    callback_probe_country: undefined,
    callback_probe_colo: undefined,
    body_signals: ['challenge_page'],
  });
  assert(!JSON.stringify(result).includes('secret'));
  assert.equal(
    (
      await responseDiagnostic(
        Response.json({ error: 'Invalid signature', secret: 'private' }, { status: 403 }),
      )
    ).category,
    'signature_rejected',
  );
  const blocked = await responseDiagnostic(
    new Response(
      '<html>Attention Required Cloudflare <span>Error code:</span><b>1009</b> ' +
        'Sorry, you have been blocked private-value</html>',
      {
        status: 403,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cf-error-type': '1009',
          'cf-error-origin': 'edge',
          server: 'cloudflare',
          'cf-ray': 'def-HKG',
          'set-cookie': 'secret-cookie',
          location: 'https://private.example/key',
        },
      },
    ),
  );
  assert.equal(blocked.edge_error_code, '1009');
  assert.equal(blocked.edge_error_type, '1009');
  assert.equal(blocked.edge_error_origin, 'edge');
  assert.deepEqual(blocked.body_signals, ['cloudflare', 'blocked_page', 'attention_required']);
  assert(!/private|secret-cookie/.test(JSON.stringify(blocked)));
  assert.deepEqual(
    (
      await responseDiagnostic(
        new Response('x'.repeat(8192) + 'cloudflare', {
          status: 403,
          headers: { 'content-type': 'text/html' },
        }),
      )
    ).body_signals,
    [],
  );
});
test('block-page network evidence is bounded and never exposes client IP or response text', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000500 });
  for (const [ip, kind] of [
    ['2a06:98c0:3600::103', 'workers_cross_zone'],
    ['192.0.2.17', 'other'],
  ]) {
    const body = `<html>Cloudflare Sorry, you have been blocked <span id="cf-footer-ip">${ip}</span>private-body</html>`;
    const result = await responseDiagnostic(
      new Response(body, {
        status: 403,
        headers: {
          'content-type': 'text/html',
          date: new Date(1800000000000).toUTCString(),
          'retry-after': '30',
        },
      }),
    );
    assert.equal(result.reported_client_ip?.kind, kind);
    assert.equal(result.reported_client_ip?.sha256, createHash('sha256').update(ip).digest('hex'));
    assert.equal(result.clock_skew_ms, -500);
    assert.equal(result.retry_after_seconds, 30);
    assert(!JSON.stringify(result).includes(ip));
    assert(!JSON.stringify(result).includes('private-body'));
  }
  const bounded = await responseDiagnostic(
    new Response('x'.repeat(8192) + '<span id="cf-footer-ip">192.0.2.17</span>'),
  );
  assert.equal(bounded.body_prefix_bytes, 8192);
  assert.equal(bounded.reported_client_ip, undefined);
});
const input = {
  name: 'gateway.request.updated',
  arguments: { connection_id: 'mini' },
  delivery: { mode: 'webhook', url: 'https://receiver.example.com/events', secret },
};
const event = (id = 'event-1', overrides = {}): Notice => ({
  eventId: id,
  name: 'gateway.request.updated',
  timestamp: new Date().toISOString(),
  data: {
    connection_id: 'mini',
    interface: 'app_tools',
    runtime_id: 'runtime-a',
    tracking: 'thread_turn',
    request_id: id,
    rpc_status: 'returned',
    status: 'completed',
    ...overrides,
  },
});
function fixture() {
  const store = new MemoryStore();
  const delivered: any[] = [];
  const verification: any[] = [];
  const logs: Record<string, any>[] = [];
  let status = 200;
  let responseBody: string | null = null;
  let responseHeader: Record<string, string> = {};
  let authorized = true;
  let echo = true;
  const transport = async (_url: string, init: RequestInit) => {
    const body = String(init.body),
      data = JSON.parse(body),
      h = new Headers(init.headers);
    const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`${h.get('webhook-id')}.${h.get('webhook-timestamp')}.${body}`)
      .digest('base64');
    assert(
      h
        .get('webhook-signature')
        ?.split(' ')
        .includes('v1,' + expected),
    );
    assert.equal(init.redirect, 'manual');
    assert(h.get('X-MCP-Subscription-Id'));
    assert.match(h.get('user-agent') ?? '', /^dotx-server\//);
    if (data.type === 'verification') {
      verification.push(data);
      return Response.json({ challenge: echo ? data.challenge : 'wrong' });
    }
    assert.equal(h.get('webhook-id'), data.eventId);
    delivered.push(data);
    if (!status) throw new Error('private-network-error');
    return new Response(responseBody, {
      status,
      headers: { ...(responseBody ? { 'content-type': 'text/html' } : {}), ...responseHeader },
    });
  };
  const create = () =>
    new Events(store, {
      transport,
      authorized: async () => authorized,
      log: (record) => logs.push(record),
    });
  return {
    store,
    create,
    delivered,
    verification,
    logs,
    status: (value: number, body: string | null = null, headers: Record<string, string> = {}) => {
      status = value;
      responseBody = body;
      responseHeader = headers;
    },
    access: (value: boolean) => (authorized = value),
    echo: (value: boolean) => (echo = value),
  };
}

test('standard webhook signatures, callback restrictions and secret validation', async () => {
  const body = '{"test":true}';
  assert.equal(
    await sign(secret, 'id', '123', body),
    'v1,' +
      createHmac('sha256', Buffer.alloc(32, 7))
        .update('id.123.' + body)
        .digest('base64'),
  );
  for (const url of [
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://169.254.169.254',
    'https://user:password@example.com',
    'https://example.com:123',
    'https://a.local',
    'https://localhost',
    'https://example.com/#fragment',
  ])
    assert.throws(() => callbackURL(url));
  assert.equal(callbackURL('https://receiver.example.com/events'), input.delivery.url);
  for (const key of [
    '',
    'whsec_bad',
    'whsec_' + Buffer.alloc(23).toString('base64'),
    'whsec_' + Buffer.alloc(65).toString('base64'),
  ])
    assert.throws(() => secretBytes(key));
});

test('MCP events discover alongside six tools; real custom methods and categorized callback failure', async () => {
  const f = fixture(),
    events = f.create();
  const invoke = async (method: string, params: object = {}) => {
    const req = new Request('https://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': method,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    return (
      await serveMcp(req, {
        scopes: ['mcp:read'],
        connections: async () => ({}),
        invoke: async () => ({}),
        events: (m, a) => events.invoke(auth, m, a),
      })
    ).json<any>();
  };
  assert.deepEqual((await invoke('server/discover')).result.capabilities.events, {});
  assert.equal((await invoke('tools/list')).result.tools.length, 6);
  assert.equal((await invoke('events/list')).result.events.length, 2);
  f.echo(false);
  const failure = (await invoke('events/subscribe', input)).error;
  const { attempt, ...failureData } = failure.data;
  assert.deepEqual(
    { ...failure, data: failureData },
    {
      code: -32015,
      message: 'CallbackEndpointError',
      data: { reason: 'challenge_failed' },
    },
  );
  assert.equal(attempt.http_status, 200);
  assert.equal(attempt.response.category, 'http_success');
  assert.equal(attempt.phase, 'verification');
  assert.equal(attempt.callback_origin, 'https://receiver.example.com');
  assert(!JSON.stringify(attempt).includes(secret));
  f.echo(true);
  assert.match((await invoke('events/subscribe', input)).result.id, /^sub_/);
});

test('bounded callback history retains failed and successful attempts through refresh and stop', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const f = fixture();
  const privateInput = {
    ...input,
    delivery: { ...input.delivery, url: input.delivery.url + '?key=private-callback' },
  };
  await f.create().invoke(auth, 'events/subscribe', privateInput);
  f.status(403, '<html>Cloudflare Access denied</html>');
  await f.create().ingest('mini', [event('retry')]);
  await f.create().alarm();
  t.mock.timers.tick(30000);
  f.status(200);
  await f.create().alarm();
  let s = (await f.create().status(auth)).subscriptions[0];
  assert.equal(s.verification?.response?.category, 'challenge_verified');
  assert.deepEqual(
    s.recent_attempts.map((a) => a.http_status),
    [403, 200],
  );
  const [first, second] = s.recent_attempts;
  assert.deepEqual(
    s.recent_attempts.map((a) => a.attempt_number),
    [1, 2],
  );
  assert.deepEqual(
    s.recent_attempts.map((a) => a.alarm_ordinal),
    [1, 1],
  );
  assert.notEqual(first.alarm_id, second.alarm_id);
  assert.equal(Date.parse(second.signed_at!) - Date.parse(first.signed_at!), 30000);
  assert.equal(second.event_age_ms! - first.event_age_ms!, 30000);
  assert.equal(first.signature_count, 1);
  assert.equal(first.signing_delay_ms, 0);
  assert.equal(first.webhook_id, second.webhook_id);
  assert.equal(first.request_sha256, second.request_sha256);
  assert.equal(
    first.request_sha256,
    createHash('sha256').update(JSON.stringify(f.delivered[0])).digest('hex'),
  );
  assert.equal(first.request_bytes, Buffer.byteLength(JSON.stringify(f.delivered[0])));
  assert.equal(first.callback_sha256, s.verification?.callback_sha256);
  assert(!/private-callback|whsec_/.test(JSON.stringify(s)));
  await f.create().invoke(auth, 'events/subscribe', privateInput);
  assert.equal((await f.create().status(auth)).subscriptions[0].recent_attempts.length, 2);
  for (let i = 0; i < 13; i++) {
    await f.create().ingest('mini', [event('bounded-' + i)]);
    await f.create().alarm();
  }
  s = (await f.create().status(auth)).subscriptions[0];
  assert.equal(s.recent_attempts.length, 12);
  assert.equal(s.recent_attempts[0].webhook_id, 'bounded-1');
  await f.create().invoke(auth, 'events/unsubscribe', {
    ...privateInput,
    delivery: { mode: 'webhook', url: privateInput.delivery.url },
  });
  assert.deepEqual(
    (await f.create().status(auth)).subscriptions[0].recent_attempts,
    s.recent_attempts,
  );
});

test('durable subscription, deduplicated ingress, negative filter and restart delivery', async () => {
  const f = fixture();
  const first: any = await f.create().invoke(auth, 'events/subscribe', input);
  const again: any = await f.create().invoke(auth, 'events/subscribe', { ...input, ttlMs: 60000 });
  assert.equal(first.id, again.id);
  assert.equal(f.verification.length, 1);
  const e = event();
  assert.equal(
    matchesEvent(
      'gateway.request.updated',
      { connection_id: 'mini', request_id: 'query' },
      event('query', { tracking: 'native' }),
    ),
    false,
    'an explicit request filter must not turn ordinary RPC replies into notifications',
  );
  await Promise.all([f.create().ingest('mini', [e]), f.create().ingest('mini', [e])]);
  await f.create().ingest('mini', [event('query', { tracking: 'native' })]);
  await f.create().alarm();
  await f.create().alarm();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.delivered[0].data.request_id, 'event-1');
  assert.equal(f.delivered[0].cursor, 'e1:1');
  assert.equal((await f.create().status(auth)).subscriptions[0].delivered, 1);
  await assert.rejects(f.create().ingest('book', [e]), { code: 'EVENT_SOURCE_MISMATCH' });
  await assert.rejects(f.create().ingest('mini', [event('event-1', { status: 'running' })]), {
    code: 'EVENT_ID_CONFLICT',
  });
  await assert.rejects(
    f.create().invoke({ principal: 'other', devices: [] }, 'events/subscribe', input),
    { code: 'CONNECTION_NOT_AUTHORIZED' },
  );
});

test('retries preserve ID and ordered cursor, refresh cannot skip pending; unsubscribe stops delivery', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const f = fixture();
  await f.create().invoke(auth, 'events/subscribe', input);
  f.status(503);
  await f.create().ingest('mini', [event('one'), event('two')]);
  await f.create().alarm();
  const renewed: any = await f
    .create()
    .invoke(auth, 'events/subscribe', { ...input, cursor: 'e1:2' });
  assert.equal(renewed.cursor, 'e1:0');
  assert.equal((await f.create().status(auth)).subscriptions[0].pending_event_id, 'one');
  t.mock.timers.tick(3000);
  f.status(200);
  await f.create().alarm();
  await f.create().alarm();
  assert.deepEqual(
    f.delivered.map((e) => e.eventId),
    ['one', 'one', 'two'],
  );
  const { secret: _secret, ...delivery } = input.delivery;
  await f.create().invoke(auth, 'events/unsubscribe', { ...input, delivery });
  await f.create().invoke(auth, 'events/unsubscribe', { ...input, delivery });
  await f.create().ingest('mini', [event('three')]);
  await f.create().alarm();
  assert.equal(f.delivered.length, 3);
});

test('expired/revoked subscriptions stop; application 403, 410, 413 and redirects never retry', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  for (const status of [403, 410, 413, 302]) {
    const f = fixture();
    await f.create().invoke(auth, 'events/subscribe', input);
    f.status(status);
    await f.create().ingest('mini', [event()]);
    await f.create().alarm();
    t.mock.timers.tick(3600000);
    await f.create().alarm();
    assert.equal(f.delivered.length, 1);
    assert.equal((await f.create().status(auth)).subscriptions[0].state, 'failed');
  }
  for (const reason of ['expired', 'revoked']) {
    const f = fixture();
    await f.create().invoke(auth, 'events/subscribe', { ...input, ttlMs: 60000 });
    await f.create().ingest('mini', [event()]);
    if (reason === 'expired') t.mock.timers.tick(60001);
    else f.access(false);
    await f.create().alarm();
    assert.equal(f.delivered.length, 0);
    assert.equal((await f.create().status(auth)).subscriptions[0].state, reason);
  }
});

test('failed subscription refresh without cursor replays the original event', async () => {
  const f = fixture();
  const first: any = await f.create().invoke(auth, 'events/subscribe', input);
  f.status(403);
  await f.create().ingest('mini', [event('original')]);
  await f.create().alarm();
  f.status(200);
  const refreshed: any = await f.create().invoke(auth, 'events/subscribe', input);
  assert.equal(refreshed.id, first.id);
  assert.equal(refreshed.cursor, 'e1:0');
  await f.create().alarm();
  assert.deepEqual(
    f.delivered.map((e) => e.eventId),
    ['original', 'original'],
  );
  assert.equal((await f.create().status(auth)).subscriptions[0].delivered, 1);
});

test('retryable failures allow exactly nine fast retries through restarts, then stop', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  for (const status of [0, 408, 429, 500, 503, 403]) {
    const f = fixture();
    await f.create().invoke(auth, 'events/subscribe', input);
    await f.create().ingest('mini', [event('original')]);
    f.status(status, '<html>Cloudflare: Access denied private-response</html>');
    await f.create().alarm();
    for (const [index, delay] of [
      2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000, 15000,
    ].entries()) {
      const s = (await f.create().status(auth)).subscriptions[0];
      assert.equal(s.state, 'active');
      assert.equal(Date.parse(s.retry_at!) - Date.now(), delay);
      t.mock.timers.tick(delay - 1);
      await f.create().alarm();
      assert.equal(f.delivered.length, index + 1);
      t.mock.timers.tick(1);
      await f.create().alarm();
    }
    const s = (await f.create().status(auth)).subscriptions[0];
    assert.equal(s.state, 'failed');
    assert.equal(s.delivery_attempt, 10);
    assert.equal(s.retry_at, undefined);
    assert.equal(s.recent_attempts.at(-1)?.outcome, 'retries_exhausted');
    assert.equal(s.recent_attempts.length, 10);
    assert.equal(new Set(s.recent_attempts.map((a) => a.request_sha256)).size, 1);
    assert.equal(new Set(s.recent_attempts.map((a) => a.signed_at)).size, 10);
    t.mock.timers.tick(3600000);
    await f.create().alarm();
    assert.equal(f.delivered.length, 10);
    assert(f.delivered.every((e) => e.eventId === 'original'));
    assert(!JSON.stringify(f.logs).includes('private-'));
    assert.equal(f.logs.filter((l) => l.phase === 'event').length, 10);
  }
});

test('ninth retry can succeed, retains safe diagnostics and does not redeliver after restart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const f = fixture();
  await f.create().invoke(auth, 'events/subscribe', {
    ...input,
    delivery: { ...input.delivery, url: input.delivery.url + '?key=private-callback' },
  });
  await f.create().ingest('mini', [event('last-retry')]);
  f.status(403, '<html>Cloudflare: Access denied private-response</html>', {
    'cf-ray': 'sample-SYD',
  });
  for (let i = 0; i < 9; i++) {
    await f.create().alarm();
    t.mock.timers.tick(
      Date.parse((await f.create().status(auth)).subscriptions[0].retry_at!) - Date.now(),
    );
  }
  f.status(200);
  await f.create().alarm();
  await f.create().alarm();
  const s = (await f.create().status(auth)).subscriptions[0];
  assert.equal(s.state, 'active');
  assert.equal(s.delivered, 1);
  assert.equal(s.pending_event_id, undefined);
  assert.equal(s.recent_attempts.at(-1)?.outcome, 'accepted');
  assert.equal(f.delivered.length, 10);
  assert.equal(f.logs[1].response.edge_id, 'sample-SYD');
  assert.equal(f.logs[1].max_attempts, 10);
  assert.equal(f.logs.at(-1)?.outcome, 'accepted');
  const serialized = JSON.stringify(f.logs);
  assert(!serialized.includes(secret));
  assert(!/private-|webhook-signature|\/events/.test(serialized));
});

test('Retry-After seconds and HTTP date override fast backoff', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  for (const header of ['60', new Date(Date.now() + 60000).toUTCString()]) {
    const f = fixture();
    await f.create().invoke(auth, 'events/subscribe', input);
    await f.create().ingest('mini', [event()]);
    const expected = header === '60' ? 60000 : Math.max(0, Date.parse(header) - Date.now());
    f.status(429, null, { 'retry-after': header });
    await f.create().alarm();
    assert.equal(
      Date.parse((await f.create().status(auth)).subscriptions[0].retry_at!) - Date.now(),
      Math.max(2000, expected),
    );
  }
});

test('replay after expiry and explicit history truncation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const f = fixture();
  await f.create().ingest('mini', [event('old')]);
  const sub: any = await f
    .create()
    .invoke(auth, 'events/subscribe', { ...input, cursor: 'e1:0', ttlMs: 60000 });
  assert.equal(sub.truncated, false);
  await f.create().alarm();
  assert.equal(f.delivered[0].eventId, 'old');
  t.mock.timers.tick(8 * 86400000);
  await f.create().alarm();
  const replay: any = await f
    .create()
    .invoke(auth, 'events/subscribe', { ...input, cursor: 'e1:0' });
  assert.equal(replay.truncated, true);
  assert.equal(replay.cursor, 'e1:1');
});
