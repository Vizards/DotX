import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { BridgeError, errorCode } from '@dotx/shared/errors';
import { canonical } from '@dotx/shared/gateway';
import type { InterfaceStatus, NativeEvent, NativeResponse } from '@dotx/shared/gateway';
import type { Adapter, Method } from '../adapter.ts';
import { EventBuffer } from '../../events/buffer.ts';
import { CoordinationView, targetKey, identity } from './view.ts';
import type { FollowTarget, Interaction } from './view.ts';
import { CoordinationWire, applyStatePatches } from './transport.ts';
import type { WireMessage } from './transport.ts';

const targetSchema = z.object({
  hostId: z.string().min(1).default('local'),
  conversationId: z.string().min(1),
});
// PRIVATE CODEX API: public App Server request names map to private desktop response methods.
// CLI-generated response schemas validate payloads, not this mapping or its owner/version envelope.
const responseMethods: Record<string, string> = {
  'item/commandExecution/requestApproval': 'thread-follower-command-approval-decision',
  'item/fileChange/requestApproval': 'thread-follower-file-approval-decision',
  'item/permissions/requestApproval': 'thread-follower-permissions-request-approval-response',
  'item/tool/requestUserInput': 'thread-follower-submit-user-input',
  'mcpServer/elicitation/request': 'thread-follower-submit-mcp-server-elicitation-response',
};
const asyncMethod = 'request_user_input_async';
const targetProperties = {
  hostId: { type: 'string', default: 'local' },
  conversationId: { type: 'string' },
};
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
interface FollowState extends FollowTarget {
  owner: string;
  state?: WireMessage;
  revision?: number;
  pendingSnapshot?: Promise<FollowState>;
  snapshotWaiters: Set<{ resolve: (s: FollowState) => void; reject: (e: Error) => void }>;
}
function turns(state: WireMessage): WireMessage[] {
  // Private desktop state has live turns and normalized history; App Server thread/read differs.
  const entries = [
    ...(state.turns ?? []),
    ...Object.values(state.turnHistory?.history?.entitiesByKey ?? {}),
  ] as WireMessage[];
  return [...new Map(entries.filter((t) => t.turnId).map((t) => [t.turnId, t])).values()];
}
function* asyncQuestions(state: WireMessage) {
  for (const turn of turns(state))
    for (const item of turn.items ?? [])
      if (item.type === 'agentMessage' && item.delivery === 'async' && item.questions?.length)
        yield { turnId: turn.turnId, item };
}
const turnSummary = (state: WireMessage) => ({
  threadRuntimeStatus: state.threadRuntimeStatus,
  turns: turns(state).map((t) => ({ turnId: t.turnId, status: t.status, error: t.error })),
});

export class CoordinationAdapter implements Adapter {
  readonly options: {
    home: string;
    version: string;
    connectionId: string;
    events: EventBuffer;
    nativeCatalog: Method[];
    endpoint?: string;
    timeoutMs?: number;
    onState?: (target: FollowTarget) => void;
  };
  readonly wire: CoordinationWire;
  readonly view: CoordinationView;
  readonly follows = new Map<string, FollowState>();
  readonly validator = new AjvJsonSchemaValidator();
  runtimeId = randomUUID();
  ready = false;
  stopped = false;
  diagnostic?: string;
  constructor(options: CoordinationAdapter['options']) {
    this.options = options;
    this.view = new CoordinationView();
    options.events.registerRuntime(this.runtimeId);
    this.wire = new CoordinationWire({
      endpoint: options.endpoint ?? path.join(options.home, 'ipc', 'ipc.sock'),
      timeoutMs: options.timeoutMs,
      onMessage: (m) => this.receive(m),
      onDisconnect: () => this.disconnected(),
    });
    void this.connect().catch(() => {});
  }
  status(): InterfaceStatus {
    return {
      name: 'client_coordination',
      runtime_id: this.runtimeId,
      availability: this.ready ? 'online' : 'unavailable',
      version: this.options.version,
      diagnostic: this.diagnostic ? { code: this.diagnostic } : null,
    };
  }
  async methods(): Promise<Method[]> {
    await this.connect();
    // The desktop currently accepts these App Server settings fields through its private wrapper.
    // Schema discovery alone cannot prove application or inheritance: read back settings/permissions.
    const nativeSettings: any = this.options.nativeCatalog.find(
      (m) => m.name === 'thread/settings/update',
    )?.input_schema;
    const properties = { ...nativeSettings?.properties };
    delete properties.threadId;
    const settings = { type: 'object', properties, additionalProperties: false };
    return [
      {
        name: 'thread-owner-discovery',
        kind: 'request',
        input_schema: objectSchema(targetProperties, ['conversationId']),
        description:
          'Discover the current desktop owner of an existing thread. This does not create, load or take over a thread.',
      },
      {
        name: 'thread-stream-following-changed',
        kind: 'request',
        input_schema: objectSchema({ ...targetProperties, following: { type: 'boolean' } }, [
          'conversationId',
          'following',
        ]),
        description:
          'Follow or unfollow a desktop thread. following=true reads fresh settings, permissions, turn status and request handles. After a disconnect or state gap, follow again explicitly; no action or subscription is replayed. Read thread content through app_tools.',
      },
      {
        name: 'thread-follower-update-thread-settings',
        kind: 'request',
        input_schema: {
          ...objectSchema(
            {
              ...targetProperties,
              threadSettings: settings,
              activeTurnId: { type: 'string' },
              condition: { type: 'object' },
            },
            ['conversationId', 'threadSettings'],
          ),
          definitions: nativeSettings?.definitions ?? {},
        },
        description:
          'Update settings at the actual desktop owner. Permissions apply to subsequent turns. Use only the user-selected scope. Tested permission profiles: :workspace with on-request; :danger-full-access with never. Inspect a fresh following snapshot before sending real work. Raw native applied=true is not task completion.',
      },
      ...this.options.nativeCatalog
        .filter((m) => m.kind === 'server_request' && responseMethods[m.name])
        .map((m) => ({
          ...m,
          description:
            (m.description ?? '') +
            ' Desktop-owned request: answer through respond(event_id), never through an independent App Server. Verify scope and user authorization.',
        })),
      {
        name: asyncMethod,
        kind: 'notification',
        input_schema: { type: 'object' },
        description:
          'Async questions from the desktop. Reply with an ordinary app_tools send_message_to_thread message, not respond. Include enough question context; the original turn may already have ended. No per-question answer state is maintained.',
      },
      {
        name: 'thread-stream-state-changed',
        kind: 'notification',
        input_schema: { type: 'object' },
        description:
          'Thread runtime and turn IDs/status changed. Settings are read on demand with following=true; content through app_tools. Approvals and blocking inputs are server_request events; async questions are notifications.',
      },
      {
        name: 'interaction/updated',
        kind: 'notification',
        input_schema: { type: 'object' },
        description:
          'Native request response state changed. Match interaction_key and the original turn; resolution is not task completion.',
      },
    ];
  }
  emit(
    native: WireMessage,
    kind: NativeEvent['kind'] = 'notification',
    extra: Partial<NativeEvent> = {},
  ) {
    return this.options.events.addEvent({
      connection_id: this.options.connectionId,
      interface: 'client_coordination',
      runtime_id: this.runtimeId,
      kind,
      native,
      ...extra,
    });
  }
  disconnected() {
    if (this.stopped) return;
    this.ready = false;
    this.diagnostic ??= 'COORDINATION_DISCONNECTED';
    this.options.events.expireRuntime(this.runtimeId);
    for (const f of this.follows.values())
      for (const w of f.snapshotWaiters) w.reject(new BridgeError('COORDINATION_DISCONNECTED'));
    const targets = [...this.follows.values()];
    this.follows.clear();
    for (const target of targets) this.options.onState?.(target);
    this.view.interactions.clear();
    if (!this.stopped) {
      this.emit({ method: 'runtime/ended' }, 'lifecycle');
      this.runtimeId = randomUUID();
      this.options.events.registerRuntime(this.runtimeId);
    }
  }
  async connect() {
    if (this.stopped) throw new BridgeError('COORDINATION_CLOSED');
    try {
      await this.wire.connect();
      this.ready = true;
      this.diagnostic = undefined;
    } catch (error) {
      this.ready = false;
      this.diagnostic = errorCode(error) ?? 'COORDINATION_CONNECT_FAILED';
      throw error;
    }
  }
  invalidate(f: FollowState, code: string) {
    f.state = undefined;
    for (const waiter of f.snapshotWaiters) waiter.reject(new BridgeError(code));
    this.options.onState?.(f);
    this.emit({ method: 'subscription/unavailable', params: { ...fTarget(f), code } }, 'lifecycle');
    // Leave the stream unavailable until an explicit read/follow, without fetching a snapshot.
    if (f.owner) {
      try {
        this.wire.follow(f.hostId, f.conversationId, f.owner, false);
      } catch {}
    }
  }
  async owner(target: FollowTarget) {
    await this.connect();
    const r = await this.wire.request('thread-owner-discovery', target, 1);
    if (r.resultType !== 'success' || typeof r.handledByClientId !== 'string')
      throw new BridgeError(
        'COORDINATION_OWNER_UNAVAILABLE',
        String(r.error ?? 'No desktop owner'),
      );
    return r;
  }
  async snapshot(target: FollowTarget): Promise<FollowState> {
    const key = targetKey(target);
    let f = this.follows.get(key);
    if (f?.pendingSnapshot) return f.pendingSnapshot;
    f ??= { ...target, owner: '', snapshotWaiters: new Set() };
    this.follows.set(key, f);
    const current = f;
    current.pendingSnapshot = (async () => {
      const owner = (await this.owner(target)).handledByClientId;
      if (current.owner && current.owner !== owner) {
        this.wire.follow(target.hostId, target.conversationId, current.owner, false);
        current.state = undefined;
        current.revision = undefined;
      }
      current.owner = owner;
      const received = new Promise<FollowState>((resolve, reject) => {
        const waiter = {
          resolve: (s: FollowState) => {
            clearTimeout(timer);
            current.snapshotWaiters.delete(waiter);
            resolve(s);
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            current.snapshotWaiters.delete(waiter);
            reject(e);
          },
        };
        const timer = setTimeout(
          () => waiter.reject(new BridgeError('COORDINATION_SNAPSHOT_TIMEOUT')),
          this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
        current.snapshotWaiters.add(waiter);
      });
      try {
        this.wire.follow(target.hostId, target.conversationId, owner, false);
        this.wire.follow(target.hostId, target.conversationId, owner, true);
      } catch (e) {
        for (const w of current.snapshotWaiters) w.reject(e as Error);
      }
      return received;
    })()
      .catch((error) => {
        this.invalidate(current, errorCode(error) ?? 'COORDINATION_SNAPSHOT_UNAVAILABLE');
        throw error;
      })
      .finally(() => {
        current.pendingSnapshot = undefined;
      });
    return current.pendingSnapshot;
  }
  receive(message: WireMessage) {
    if (message.type !== 'broadcast' || message.method !== 'thread-stream-state-changed') return;
    const target = targetSchema.safeParse(message.params);
    if (!target.success) return;
    const f = this.follows.get(targetKey(target.data));
    if (!f || message.sourceClientId !== f.owner) return;
    // Native state-message revision, NOT a Codex release allowlist. v11 was observed on
    // 26.1007.71326 and rechecked on 26.1013.31256; a new revision needs its shape verified.
    if (message.version !== 11) {
      this.diagnostic = 'COORDINATION_STATE_VERSION_MISMATCH';
      this.ready = false;
      for (const waiter of f.snapshotWaiters) waiter.reject(new BridgeError(this.diagnostic));
      this.wire.close();
      return;
    }
    const change = message.params.change;
    const previous = f.state;
    if (change.type === 'snapshot') {
      if (
        change.conversationState?.id !== f.conversationId ||
        change.conversationState?.hostId !== f.hostId
      )
        throw new BridgeError('COORDINATION_THREAD_IDENTITY_MISMATCH');
      f.state = change.conversationState;
      f.revision = change.revision;
    } else if (change.type === 'patches') {
      if (!f.state || f.revision !== change.baseRevision) {
        this.invalidate(f, 'COORDINATION_REVISION_GAP');
        return;
      }
      try {
        f.state = applyStatePatches(f.state, change.patches);
        f.revision = change.revision;
      } catch {
        this.invalidate(f, 'COORDINATION_INVALID_PATCH');
        return;
      }
    } else return;
    this.observe(f, change.type === 'snapshot', previous);
    if (change.type === 'snapshot') for (const w of f.snapshotWaiters) w.resolve(f);
  }
  current(target: FollowTarget) {
    const f = this.follows.get(targetKey(target));
    return f?.state ? this.summary(f) : undefined;
  }
  async read(target: FollowTarget) {
    return this.summary(await this.snapshot(target));
  }
  summary(f: FollowState) {
    const s = f.state!;
    return {
      hostId: f.hostId,
      conversationId: f.conversationId,
      latestThreadSettings: s.latestThreadSettings,
      currentPermissions: s.currentPermissions,
      threadRuntimeStatus: s.threadRuntimeStatus,
      turns: turns(s).map((t) => ({ turnId: t.turnId, status: t.status, error: t.error })),
      interactions: this.view.forTarget(f).map((i) => ({
        interaction_key: i.key,
        event_id: i.eventId,
        turnId: i.turnId,
        status: i.status,
        response_result: i.responseResult,
      })),
    };
  }
  release(row: Interaction) {
    // Keep the final response on the bounded event, not in a separate historical ledger.
    const event = row.eventId && this.options.events.event(row.eventId);
    if (event) Object.assign(event, this.view.decorate(event));
    this.view.interactions.delete(row.key);
  }
  observe(f: FollowState, snapshot = false, previous?: WireMessage) {
    const s = f.state!;
    const present = new Set<string>();
    const record = (i: Interaction) => {
      present.add(i.key);
      const current = this.view.observe(i);
      if (!current.eventId) {
        const event = this.emit(
          {
            ...i.native,
            params: {
              ...i.native.params,
              hostId: i.hostId,
              conversationId: i.conversationId,
              turnId: i.turnId,
            },
          },
          'server_request',
          {
            interaction_key: i.key,
            response_status: current.status,
            response_schema: i.responseSchema,
          },
        );
        current.eventId = event.event_id;
      }
      return current;
    };
    // Private snapshot requests[] is the pending desktop request set. Disappearance means
    // answered OR cleared/cancelled; it is not proof that the approved task completed.
    for (const request of s.requests ?? []) {
      const method = request.method;
      if (!responseMethods[method] || !request.params?.turnId) continue;
      const schema = this.options.nativeCatalog.find(
        (m) => m.name === method && m.kind === 'server_request',
      )?.output_schema;
      if (!schema) continue;
      const key = identity([
        f.hostId,
        f.conversationId,
        request.params.turnId,
        method,
        request.id,
        request.params,
      ]);
      record({
        key,
        kind: 'native_request',
        hostId: f.hostId,
        conversationId: f.conversationId,
        owner: f.owner,
        turnId: request.params.turnId,
        native: request,
        responseSchema: schema,
        status: 'pending',
      });
    }
    // PRIVATE MESSAGE SHAPE: async questions live in agentMessage.delivery/questions,
    // outside requests[]. Recheck this extractor after desktop changes or notices may vanish.
    // Seeing an old question is not evidence it is unanswered; keep no per-question answer state.
    // Compare against the native snapshot already needed for patches. Old history must not
    // become a new question when its notification falls out of the bounded event buffer.
    const seen = new Set(
      [...asyncQuestions(previous ?? {})].map(({ turnId, item }) => canonical([turnId, item.id])),
    );
    for (const { turnId, item } of asyncQuestions(s)) {
      const localKey = canonical([turnId, item.id]);
      if (seen.has(localKey)) continue;
      seen.add(localKey);
      const key = identity([f.hostId, f.conversationId, turnId, asyncMethod, item.id]);
      if (
        this.options.events.rows.some(
          (event) => event.runtime_id === this.runtimeId && event.interaction_key === key,
        )
      )
        continue;
      this.emit(
        {
          id: item.id,
          method: asyncMethod,
          params: { ...fTarget(f), turnId, questions: item.questions },
        },
        'notification',
        { interaction_key: key },
      );
    }
    for (const old of this.view.forTarget(f)) {
      if (!present.has(old.key) && old.status !== 'resolved')
        Object.assign(old, {
          status: 'resolved',
          responseResult: { original_turn_id: old.turnId, request_removed: true },
        });
      const now = old;
      const serialized = canonical([now.status, now.responseResult]);
      if (now.publishedState !== serialized) {
        now.publishedState = serialized;
        this.emit({
          method: 'interaction/updated',
          params: {
            interaction_key: now.key,
            ...fTarget(f),
            status: now.status,
            response_result: now.responseResult,
          },
        });
      }
      if (now.status === 'resolved') this.release(now);
    }
    const summary = {
      ...fTarget(f),
      ...turnSummary(s),
    };
    const changed = !previous || canonical(turnSummary(previous)) !== canonical(turnSummary(s));
    if (changed) {
      this.emit({ method: 'thread-stream-state-changed', params: summary });
    }
    if (changed || snapshot) this.options.onState?.(f);
  }
  async call(method: string, params: Record<string, unknown>): Promise<NativeResponse> {
    const target = targetSchema.parse(params);
    if (method === 'thread-owner-discovery') return { result: await this.owner(target) };
    if (method === 'thread-stream-following-changed') {
      const following = z.boolean().parse(params.following);
      if (!following) {
        const old = this.follows.get(targetKey(target));
        if (old) this.wire.follow(target.hostId, target.conversationId, old.owner, false);
        for (const row of this.view.forTarget(target)) {
          row.status = 'expired';
          this.release(row);
        }
        this.follows.delete(targetKey(target));
        this.options.onState?.(target);
        return { result: { ...target, following: false } };
      }
      return { result: { following: true, ...this.summary(await this.snapshot(target)) } };
    }
    if (method === 'thread-follower-update-thread-settings') {
      const schema = (await this.methods()).find((m) => m.name === method)!.input_schema;
      if (!this.validator.getValidator(schema as any)(params).valid)
        throw new BridgeError('COORDINATION_INVALID_SETTINGS');
      const f = await this.snapshot(target);
      const { hostId: _host, ...nativeParams } = params;
      // Private settings RPC uses v2 locally, v3 for host routing. applied only acknowledges
      // the setting update; a running turn or later App Tools send may keep/replace its values.
      const reply = await this.wire.request(
        method,
        nativeParams,
        2 + (target.hostId === 'local' ? 0 : 1),
        f.owner,
        target.hostId,
      );
      return reply.resultType === 'success'
        ? { result: reply.result }
        : { error: { code: -32000, message: String(reply.error) } };
    }
    throw new BridgeError('NATIVE_METHOD_NOT_FOUND');
  }
  decorateEvent(event: NativeEvent) {
    return this.view.decorate(event);
  }
  interaction(event: NativeEvent) {
    if (event.kind !== 'server_request' || !responseMethods[event.native.method as string])
      throw new BridgeError('SERVER_REQUEST_NOT_PENDING');
    const row = event.interaction_key && this.view.get(event.interaction_key);
    if (!row || row.eventId !== event.event_id) throw new BridgeError('SERVER_REQUEST_NOT_PENDING');
    const params = event.native.params as WireMessage | undefined;
    if (row.hostId !== params?.hostId || row.conversationId !== params?.conversationId)
      throw new BridgeError('INTERACTION_SOURCE_MISMATCH');
    return row;
  }
  async prepareResponse(event: NativeEvent, response: NativeResponse) {
    const row = this.interaction(event);
    if (response.error)
      throw new BridgeError(
        'COORDINATION_RESPONSE_REQUIRES_RESULT',
        'Use the native decision (including decline/cancel) or question answer; this desktop channel has no generic error response.',
      );
    if (
      !row.responseSchema ||
      !this.validator.getValidator(row.responseSchema as any)(response.result).valid
    )
      throw new BridgeError(
        'INVALID_INTERACTION_RESPONSE',
        'Answer must match the response_schema returned by read_events',
      );
    if (row.native.method === 'item/tool/requestUserInput') {
      const ids = new Set(row.native.params.questions.map((q: any) => q.id));
      if (Object.keys((response.result as WireMessage).answers).some((id) => !ids.has(id)))
        throw new BridgeError('QUESTION_ID_MISMATCH');
    }
    const f = await this.snapshot(row);
    this.validatePending(row, f);
  }
  validatePending(row: Interaction, f: FollowState) {
    if (this.view.get(row.key)?.status !== 'pending')
      throw new BridgeError('SERVER_REQUEST_NOT_PENDING');
    if (f.owner !== row.owner) throw new BridgeError('COORDINATION_OWNER_CHANGED');
    const request = f.state!.requests?.find(
      (q: any) =>
        q.id === row.native.id && q.method === row.native.method && q.params?.turnId === row.turnId,
    );
    if (!request || canonical(request.params) !== canonical(row.native.params))
      throw new BridgeError('SERVER_REQUEST_NOT_PENDING');
  }

  async respond(event: NativeEvent, response: NativeResponse) {
    const row = this.interaction(event);
    // The DO has already reserved this logical answer. Validate the native handle again
    // immediately before dispatch; this view never authorizes retries.
    const f = this.follows.get(targetKey(row));
    if (!f?.state) throw new BridgeError('COORDINATION_SNAPSHOT_UNAVAILABLE');
    this.validatePending(row, f);
    Object.assign(row, { status: 'responding' });
    try {
      const method = responseMethods[row.native.method];
      const value = response.result as WireMessage;
      // Private desktop wrappers differ: command/file approvals carry decision; other requests
      // carry response. Local v1 / remote v2 is a wire convention, not inferred from CLI schema.
      const body = method.endsWith('-approval-decision')
        ? { decision: value.decision }
        : { response: value };
      const params = { conversationId: row.conversationId, requestId: row.native.id, ...body };
      const reply = await this.wire.request(
        method,
        params,
        1 + (row.hostId === 'local' ? 0 : 1),
        f.owner,
        row.hostId,
      );
      if (reply.resultType !== 'success')
        throw new BridgeError('COORDINATION_NATIVE_RESPONSE_ERROR', String(reply.error));
      // A native snapshot may resolve and release this row before the RPC reply arrives.
      if (row.status === 'resolved') return { status: row.status };
      Object.assign(row, {
        status: 'submitted',
        responseResult: { native: reply.result, original_turn_id: row.turnId },
      });
      await this.snapshot(row);
      return { status: row.status };
    } catch (e) {
      if (row.status === 'resolved') return { status: 'resolved' as const };
      Object.assign(row, {
        status: 'unknown',
        diagnostic: { code: errorCode(e) ?? 'COORDINATION_RESPONSE_OUTCOME_UNKNOWN' },
      });
      throw e;
    }
  }
  close() {
    this.stopped = true;
    this.ready = false;
    for (const f of this.follows.values())
      for (const w of f.snapshotWaiters) w.reject(new BridgeError('COORDINATION_CLOSED'));
    this.options.events.expireRuntime(this.runtimeId);
    this.follows.clear();
    this.view.interactions.clear();
    this.wire.close();
  }
}
const fTarget = (f: FollowTarget) => ({ hostId: f.hostId, conversationId: f.conversationId });
