import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import type { NoticeData, Notice } from '@dotx/shared/events';
import { startServer, toolData } from './support/server.ts';

test('event discovery and subscription methods agree on exclusive turn scopes', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const catalog = await api.rpc(token, 'events/list');
  const definition = catalog.result.events.find(
    (event: { name: string }) => event.name === 'gateway.native.event',
  );
  const validate = new CfWorkerJsonSchemaValidator().getValidator(definition.inputSchema);
  const scopes: [Record<string, string>, boolean][] = [
    [{ request_id: 'future-send' }, true],
    [{ thread_id: 'target', turn_id: 'turn', host_id: 'local' }, true],
    [{ request_id: 'future-send', thread_id: 'target', turn_id: 'turn' }, false],
    [{ thread_id: 'target' }, false],
  ];
  for (const [scope, accepted] of scopes) {
    const input = {
      name: 'gateway.native.event',
      arguments: { connection_id: device.input.device_id, ...scope },
      delivery: { mode: 'webhook', url: 'https://events.example.com/scope' },
    };
    assert.equal(validate(input.arguments).valid, accepted, JSON.stringify(scope));
    // Cancellation validates the same scope without inspecting or simulating a native turn.
    const cancelled = await api.rpc(token, 'events/unsubscribe', input);
    assert.equal(!cancelled.error, accepted, JSON.stringify(cancelled));
    if (!accepted) {
      const rejected = await api.rpc(token, 'events/subscribe', {
        ...input,
        delivery: { ...input.delivery, secret: `whsec_${randomBytes(32).toString('base64')}` },
      });
      assert.equal(rejected.error.code, -32602);
      assert.equal(rejected.error.data.name, 'ZodError');
    }
  }
});

test('event errors retain validation details and callback failures over MCP', async (t) => {
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const input = {
    name: 'gateway.native.event',
    arguments: {
      connection_id: device.input.device_id,
      thread_id: 'target',
      turn_id: 'scope-turn',
      kinds: ['not-a-kind'],
    },
    delivery: { mode: 'webhook', url: 'https://events.example.com/errors' },
  };
  const invalid = await api.rpc(token, 'events/unsubscribe', input);
  assert.equal(invalid.error.code, -32602);
  assert.equal(invalid.error.data.name, 'ZodError');
  const issues = JSON.parse(invalid.error.data.message).flatMap(
    (issue: { errors?: unknown[][] }) => issue.errors?.flat() ?? [issue],
  );
  const kindError = issues.find((issue: { path: unknown[] }) => issue.path.join('.') === 'kinds.0');
  assert(kindError.values.includes('notification'));

  const forbidden = await api.rpc(token, 'events/unsubscribe', {
    ...input,
    arguments: { connection_id: 'not-enrolled', thread_id: 'target', turn_id: 'scope-turn' },
  });
  assert.equal(forbidden.error.message, 'CONNECTION_NOT_AUTHORIZED');
  assert.equal(forbidden.error.data.code, 'CONNECTION_NOT_AUTHORIZED');

  const fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    if (String(url).startsWith('https://events.example.com/'))
      return new Response('Synthetic webhook unavailable', { status: 403 });
    return fetch(url, init);
  });
  const callback = await api.rpc(token, 'events/subscribe', {
    ...input,
    arguments: { connection_id: device.input.device_id, request_id: 'not-yet-sent' },
    delivery: { ...input.delivery, secret: `whsec_${randomBytes(32).toString('base64')}` },
  });
  assert.equal(callback.error.code, -32015);
  assert.equal(callback.error.message, 'CallbackEndpointError');
  assert.equal(callback.error.data.http_status, 403);
});

test('events deliver without replay, preserve filters and retry only while authorized', async (t) => {
  const delivered: { path: string; event: Notice & { cursor: null } }[] = [];
  let finishInFlight!: () => void;
  const inFlight = new Promise<void>((resolve) => (finishInFlight = resolve));
  t.after(() => finishInFlight());
  const fetch = globalThis.fetch;
  // The local Wrangler harness forwards outbound HTTP through Node fetch.
  // This is a generic webhook receiver, not a simulated ChatGPT/Codex client.
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://events.example.com') return fetch(input, init);
    const body = (await new Response(init.body).json()) as
      | { type: 'verification'; challenge: string }
      | (Notice & { cursor: null });
    if ('type' in body) return Response.json({ challenge: body.challenge });
    delivered.push({ path: url.pathname, event: body });
    if (
      url.pathname === '/cancel-in-flight' &&
      delivered.filter((row) => row.path === url.pathname).length === 1
    ) {
      await inFlight;
      return new Response('late permanent failure', { status: 413 });
    }
    if (url.pathname === '/terminal')
      return new Response('Synthetic failure', {
        status: delivered.filter((row) => row.path === url.pathname).length === 1 ? 503 : 413,
      });
    if (url.pathname === '/cancel-pending') return new Response('unavailable', { status: 503 });
    if (
      ['/edge-retry', '/final-retry'].includes(url.pathname) &&
      delivered.filter((row) => row.path === url.pathname).length === 1
    )
      return new Response('Cloudflare Access Denied', {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      });
    if (
      url.pathname === '/retry-revoked' ||
      (url.pathname === '/retry-allowed' &&
        delivered.filter((row) => row.path === url.pathname).length === 1)
    )
      return new Response('Synthetic webhook unavailable', {
        status: 503,
        headers: { 'Retry-After': '3' },
      });
    return new Response(null, { status: 204 });
  });
  const api = await startServer(t);
  const device = await api.enroll();
  const token = await api.authorize();
  const response = await api.request('/device/connect', {
    headers: {
      Upgrade: 'websocket',
      'X-Device-Id': device.input.device_id,
      Authorization: `Bearer ${device.token}`,
    },
  });
  assert.equal(response.status, 101);
  const socket = response.webSocket!;
  socket.accept();
  t.after(() => socket.close());
  const heartbeat = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'heartbeat',
      protocol: WIRE_VERSION,
      availability: 'online',
      interfaces: ['client_coordination', 'app_tools'].map((name) => ({
        name,
        runtime_id: 'synthetic-runtime',
        availability: 'online',
      })),
    }),
  );
  assert.equal(JSON.parse((await heartbeat)[0].data).type, 'heartbeat_ack');
  const inspection = new Map<string, string>();
  let wireTaskId = '';
  // Supply DotX's own inspection envelope; no native response/schema is simulated.
  socket.addEventListener('message', (event) => {
    const command = JSON.parse(String(event.data));
    if (command.type !== 'command') return;
    if (command.operation === 'call' || command.operation === 'read_turn') {
      wireTaskId = command.args.task.id;
      socket.send(
        JSON.stringify({
          type: 'response',
          id: command.id,
          ok: true,
          result: {
            rpc_status: 'returned',
            observation: { task_id: wireTaskId, turnId: 'wire-turn', state: 'running' },
          },
        }),
      );
      return;
    }
    assert.equal(command.operation, 'inspect_turn');
    socket.send(
      JSON.stringify({
        type: 'response',
        id: command.id,
        ok: true,
        result: {
          observation: {
            task_id: command.args.task.id,
            turnId: command.args.task.turnId,
            state: inspection.get(command.args.task.turnId) ?? 'running',
          },
        },
      }),
    );
  });

  // Inputs are DotX notice envelopes. Method/kind strings exercise routing only;
  // no native protocol payload, task execution or approval behavior is mocked.
  const notice = (method: string, data: Partial<NoticeData> = {}): Notice => ({
    eventId: randomUUID(),
    name: 'gateway.native.event',
    timestamp: new Date().toISOString(),
    data: {
      connection_id: device.input.device_id,
      interface: 'app_server',
      runtime_id: 'synthetic-runtime',
      thread_id: 'target',
      turn_id: 'scope-turn',
      kind: 'notification',
      method,
      ...data,
    },
  });
  async function send(events: Notice[]) {
    const ack = once(socket, 'message');
    socket.send(
      JSON.stringify({
        type: 'observations',
        protocol: WIRE_VERSION,
        observations: events.map((event) => ({ id: event.eventId, kind: 'notice', notice: event })),
      }),
    );
    assert.deepEqual(JSON.parse((await ack)[0].data), {
      type: 'observations_ack',
      ids: events.map((event) => event.eventId),
    });
  }
  const input = (path: string, args: Record<string, unknown> = {}) => ({
    name: 'gateway.native.event',
    arguments: {
      connection_id: device.input.device_id,
      thread_id: 'target',
      turn_id: 'scope-turn',
      ...args,
    },
    delivery: { mode: 'webhook', url: `https://events.example.com/${path}` },
  });
  async function subscribe(
    subscription: ReturnType<typeof input>,
    cursor?: string,
    accessToken = token,
  ) {
    const reply = await api.rpc(accessToken, 'events/subscribe', {
      ...subscription,
      delivery: { ...subscription.delivery, secret: `whsec_${randomBytes(32).toString('base64')}` },
      ...(cursor ? { cursor } : {}),
    });
    assert.equal(reply.error, undefined, JSON.stringify(reply));
    return reply.result;
  }
  async function expectDelivery(path: string, events: Notice[]) {
    const deadline = Date.now() + 10000;
    const received = () =>
      delivered.filter((row) => row.path === `/${path}`).map((row) => row.event.eventId);
    while (received().length < events.length && Date.now() < deadline) await delay(20);
    assert.deepEqual(
      received(),
      events.map((event) => event.eventId),
    );
  }
  const subscriptions = async () =>
    toolData((await api.tool(token, 'list_connections')).result).events.subscriptions;

  const login = notice('account/login/completed');
  await send([login, notice('turn/completed')]);
  const defaults = input('default');
  assert.equal((await subscribe(defaults)).cursor, null, 'events do not offer replay');

  const methods = [
    'account/login/completed',
    'item/agentMessage/delta',
    'example/log',
    'example/progress',
    'thread/tokenUsage/updated',
    'example/custom',
  ];
  const quiet = methods.map((method) => notice(method));
  const baseline = [
    notice('turn/completed'),
    notice('item/plan/requestImplementation', { interface: 'client_coordination' }),
    notice('example/question', { kind: 'server_request' }),
    notice('example/lifecycle', { kind: 'lifecycle' }),
  ];
  await send([...quiet, ...baseline]);
  await expectDelivery('default', baseline);

  const explicit = input('explicit', { methods, kinds: ['notification'], thread_id: 'target' });
  assert.equal((await subscribe(explicit, 'arbitrary-past-cursor')).cursor, null);
  const position = input('position', { methods: ['example/never'] });
  assert.equal(
    (await subscribe(position)).cursor,
    null,
    'later subscriptions cannot replay previously delivered events',
  );
  // Previously unselected notices can be delivered if they arrive again after subscribing.
  const selected = [login, ...quiet.slice(1)];
  const completion = notice('turn/completed');
  const otherQuestion = notice(methods[0], { kind: 'server_request', thread_id: 'other' });
  await send([
    ...selected,
    login,
    notice(methods[0], { thread_id: 'other' }),
    otherQuestion,
    completion,
  ]);
  await expectDelivery('explicit', selected);
  // Default selectors never widen the subscribed turn to another conversation.
  await expectDelivery('default', [...baseline, completion]);
  assert.equal(delivered.filter((row) => row.path === '/explicit').length, selected.length);

  // A kinds-only subscription opts into arbitrary notification names as well.
  const kinds = input('kinds', { kinds: ['notification'], thread_id: 'target' });
  assert.equal((await subscribe(kinds)).cursor, null);
  const arbitrary = notice('another/previously-unknown-event');
  await send([arbitrary]);
  await expectDelivery('kinds', [arbitrary]);

  for (const subscription of [defaults, explicit, position, kinds]) {
    const reply = await api.rpc(token, 'events/unsubscribe', subscription);
    assert.equal(reply.error, undefined);
  }
  assert.deepEqual(await subscriptions(), [], 'cancelled subscriptions disappear from status');
  assert.equal((await api.rpc(token, 'events/unsubscribe', explicit)).error, undefined);
  await send([notice(methods[0]), notice('turn/completed')]);
  assert.equal(
    (await subscribe(explicit)).cursor,
    null,
    'cancelled subscriptions do not retain later notices',
  );
  assert.deepEqual((await subscriptions())[0].pending, []);
  assert.equal(delivered.filter((row) => row.path === '/explicit').length, selected.length);
  const resumed = notice(methods[0]);
  await send([resumed]);
  await expectDelivery('explicit', [...selected, resumed]);
  assert.equal((await api.rpc(token, 'events/unsubscribe', explicit)).error, undefined);
  assert.deepEqual(await subscriptions(), []);

  // Single-turn lifetime is independent of notification selectors.
  const oneTurn = input('one-turn', { turn_id: 'lifetime' });
  const narrow = input('narrow-turn', { turn_id: 'lifetime', kinds: ['server_request'] });
  await subscribe(oneTurn);
  await subscribe(narrow);
  const question = notice('example/question', { turn_id: 'lifetime', kind: 'server_request' });
  const waiting = notice('thread-stream-state-changed', {
    turn_id: 'lifetime',
    status: 'waiting_approval',
  });
  const itemDone = notice('example/item', {
    turn_id: 'lifetime',
    kind: 'server_request',
    status: 'completed',
  });
  await send([
    question,
    waiting,
    itemDone,
    notice('thread-stream-state-changed', { turn_id: 'another-turn', status: 'completed' }),
  ]);
  await expectDelivery('one-turn', [question, waiting, itemDone]);
  await expectDelivery('narrow-turn', [question, itemDone]);
  assert.equal(
    (await subscriptions()).length,
    2,
    'input/progress/item status is not turn completion',
  );
  const ended = notice('thread-stream-state-changed', { turn_id: 'lifetime', status: 'completed' });
  inspection.set('lifetime', 'completed');
  await send([ended]);
  await expectDelivery('one-turn', [question, waiting, itemDone, ended]);
  for (let i = 0; i < 100 && (await subscriptions()).length; i++) await delay(20);
  assert.deepEqual(
    await subscriptions(),
    [],
    'both subscriptions close, even without selected completion',
  );
  const expiredRenewal = await api.rpc(token, 'events/subscribe', {
    ...oneTurn,
    delivery: { ...oneTurn.delivery, secret: `whsec_${randomBytes(32).toString('base64')}` },
  });
  assert.equal(expiredRenewal.error.message, 'SUBSCRIPTION_TURN_ENDED');
  assert.deepEqual(await subscriptions(), [], 'renewal cannot resurrect the completed turn');

  const finalRetry = input('final-retry', { turn_id: 'retry-final' });
  await subscribe(finalRetry);
  const final = notice('thread-stream-state-changed', { turn_id: 'retry-final', status: 'failed' });
  inspection.set('retry-final', 'failed');
  await send([final]);
  await expectDelivery('final-retry', [final]);
  for (let i = 0; i < 100 && !(await subscriptions())[0]?.pending.length; i++) await delay(20);
  assert.equal((await subscriptions())[0].state, 'ending');
  const duringRetry = await api.rpc(token, 'events/subscribe', {
    ...finalRetry,
    delivery: { ...finalRetry.delivery, secret: `whsec_${randomBytes(32).toString('base64')}` },
  });
  assert.equal(duringRetry.error.message, 'SUBSCRIPTION_TURN_ENDED');
  await send([notice('example/question', { turn_id: 'retry-final', kind: 'server_request' })]);
  await expectDelivery('final-retry', [final, final]);
  for (let i = 0; i < 100 && (await subscriptions()).length; i++) await delay(20);
  assert.deepEqual(await subscriptions(), [], 'accepted terminal retry removes its subscription');

  const allowedRetry = input('retry-allowed', { methods: ['example/retry'] });
  await subscribe(allowedRetry);
  const retried = notice('example/retry');
  await send([retried]);
  await expectDelivery('retry-allowed', [retried]);
  const retryDeadline = Date.now() + 2000;
  while (!(await subscriptions())[0].pending.length && Date.now() < retryDeadline) await delay(20);
  assert.equal((await subscriptions())[0].pending[0].event_id, retried.eventId);
  // Renewal keeps the failed event, while new notifications do not wait for it.
  assert.equal((await subscribe(allowedRetry)).cursor, null);
  const later = notice('example/retry');
  await send([later]);
  await expectDelivery('retry-allowed', [retried, later, retried]);
  const retrySettled = Date.now() + 2000;
  while ((await subscriptions())[0].pending.length && Date.now() < retrySettled) await delay(20);
  assert.deepEqual((await subscriptions())[0].pending, []);
  assert.equal((await api.rpc(token, 'events/unsubscribe', allowedRetry)).error, undefined);

  const edge = input('edge-retry', { methods: ['example/edge'] });
  await subscribe(edge);
  const denied = notice('example/edge');
  await send([denied]);
  await expectDelivery('edge-retry', [denied, denied]);
  assert.equal((await api.rpc(token, 'events/unsubscribe', edge)).error, undefined);

  const terminal = input('terminal', { methods: ['example/terminal'] });
  await subscribe(terminal);
  const rejectedNotice = notice('example/terminal');
  await send([rejectedNotice]);
  await expectDelivery('terminal', [rejectedNotice, rejectedNotice]);
  const terminalDeadline = Date.now() + 2000;
  while ((await subscriptions()).length && Date.now() < terminalDeadline) await delay(20);
  assert.deepEqual(await subscriptions(), [], 'terminal failure deletes the subscription');
  await subscribe(terminal);
  assert.deepEqual((await subscriptions())[0].pending, [], 'recreation has no old retries');
  assert.equal((await api.rpc(token, 'events/unsubscribe', terminal)).error, undefined);

  const pendingCancel = input('cancel-pending', { methods: ['example/pending'] });
  await subscribe(pendingCancel);
  const cancelledNotice = notice('example/pending');
  await send([cancelledNotice]);
  await expectDelivery('cancel-pending', [cancelledNotice]);
  const pendingDeadline = Date.now() + 2000;
  while (!(await subscriptions())[0].pending.length && Date.now() < pendingDeadline)
    await delay(20);
  assert.equal((await subscriptions())[0].pending.length, 1);
  assert.equal((await api.rpc(token, 'events/unsubscribe', pendingCancel)).error, undefined);
  await subscribe(pendingCancel);
  assert.deepEqual((await subscriptions())[0].pending, []);
  await delay(2200);
  assert.equal(delivered.filter((row) => row.path === '/cancel-pending').length, 1);
  assert.equal((await api.rpc(token, 'events/unsubscribe', pendingCancel)).error, undefined);

  // A callback already in flight may finish after cancellation and resubscription.
  // Its old response must neither recreate the row nor update the new subscription.
  const cancelling = input('cancel-in-flight', { methods: ['example/cancel'] });
  const cancelledId = (await subscribe(cancelling)).id;
  const late = notice('example/cancel');
  await send([late]);
  await expectDelivery('cancel-in-flight', [late]);
  assert.equal((await api.rpc(token, 'events/unsubscribe', cancelling)).error, undefined);
  assert.deepEqual(await subscriptions(), []);
  assert.equal((await subscribe(cancelling)).id, cancelledId);
  finishInFlight();
  const fresh = notice('example/cancel');
  await send([fresh]);
  await expectDelivery('cancel-in-flight', [late, fresh]);
  await delay(2200);
  assert.deepEqual((await subscriptions())[0].pending, [], 'old failure cannot recreate a retry');
  assert.equal(delivered.filter((row) => row.path === '/cancel-in-flight').length, 2);
  assert(delivered.every((row) => row.event.cursor === null));
  assert.equal((await api.rpc(token, 'events/unsubscribe', cancelling)).error, undefined);
  assert.deepEqual(await subscriptions(), []);

  // request_id may be subscribed before dispatch. Only DotX wire observations
  // drive this contract; the simulated peer implements no native Codex operation.
  const scopedRequest = (name: string, path: string, extra = {}) => ({
    name,
    arguments: { connection_id: device.input.device_id, request_id: 'wire-request', ...extra },
    delivery: {
      mode: 'webhook',
      url: `https://events.example.com/${path}`,
      secret: `whsec_${randomBytes(32).toString('base64')}`,
    },
  });
  const tracked = scopedRequest('gateway.request.updated', 'tracked', { statuses: ['completed'] });
  const interactions = scopedRequest('gateway.native.event', 'tracked-interactions');
  for (const subscription of [tracked, interactions])
    assert.equal((await api.rpc(token, 'events/subscribe', subscription)).error, undefined);
  assert.equal(
    toolData(
      (
        await api.tool(token, 'call', {
          connection_id: device.input.device_id,
          interface: 'app_tools',
          runtime_id: 'synthetic-runtime',
          request_id: 'wire-request',
          tracking: 'thread_turn',
          method: 'codex_app.send_message_to_thread',
          params: { threadId: 'target', prompt: 'opaque fixture' },
        })
      ).result,
    ).rpc_status,
    'returned',
  );
  const wireQuestion = notice('example/question', { turn_id: 'wire-turn', kind: 'server_request' });
  await send([wireQuestion]);
  await expectDelivery('tracked-interactions', [wireQuestion]);
  // Native completion must not prematurely remove the separate receipt subscription.
  const wireEnd = notice('thread-stream-state-changed', {
    turn_id: 'wire-turn',
    status: 'completed',
  });
  await send([wireEnd]);
  await expectDelivery('tracked-interactions', [wireQuestion, wireEnd]);
  assert.equal((await subscriptions()).length, 1);
  const turnAck = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'observations',
      protocol: WIRE_VERSION,
      observations: [
        {
          id: randomUUID(),
          kind: 'turn',
          task_id: wireTaskId,
          turnId: 'wire-turn',
          state: 'completed',
        },
      ],
    }),
  );
  assert.equal(JSON.parse((await turnAck)[0].data).type, 'observations_ack');
  for (let i = 0; i < 100 && (await subscriptions()).length; i++) await delay(20);
  assert.deepEqual(await subscriptions(), []);
  const terminalReceipt = delivered.filter((row) => row.path === '/tracked');
  assert.equal(terminalReceipt.length, 1);
  assert.equal(terminalReceipt[0].event.data.status, 'completed');
  for (const subscription of [tracked, interactions]) {
    assert.equal(
      (await api.rpc(token, 'events/subscribe', subscription)).error.message,
      'SUBSCRIPTION_TURN_ENDED',
    );
    const next = {
      ...subscription,
      arguments: { ...subscription.arguments, request_id: 'next-wire-request' },
    };
    assert.equal((await api.rpc(token, 'events/subscribe', next)).error, undefined);
    assert.equal(
      (
        await api.rpc(token, 'events/unsubscribe', {
          ...next,
          delivery: { mode: next.delivery.mode, url: next.delivery.url },
        })
      ).error,
      undefined,
    );
  }

  // Exercise actual OAuth revocation while one subscription is idle and another
  // has a failed delivery awaiting retry. The independent subscriber still works.
  const revocable = await api.authorizeSession(['mcp:read', 'mcp:write', 'offline_access']);
  await subscribe(
    input('retry-revoked', { methods: ['example/retry'] }),
    undefined,
    revocable.token,
  );
  await subscribe(
    input('revoked-idle', { methods: ['example/after-revoke'] }),
    undefined,
    revocable.token,
  );
  await subscribe(input('revocation-control', { methods: ['example/after-revoke'] }));
  const revokedRetry = notice('example/retry');
  await send([revokedRetry]);
  await expectDelivery('retry-revoked', [revokedRetry]);
  await revocable.revoke();
  const rejected = await api.request('/mcp', {
    headers: { Authorization: `Bearer ${revocable.token}` },
  });
  assert.equal(rejected.status, 401, await rejected.text());
  const afterRevoke = notice('example/after-revoke');
  await send([afterRevoke]);
  await expectDelivery('revocation-control', [afterRevoke]);
  await delay(3500);
  assert.equal(delivered.filter((row) => row.path === '/revoked-idle').length, 0);
  assert.equal(delivered.filter((row) => row.path === '/retry-revoked').length, 1);
});
