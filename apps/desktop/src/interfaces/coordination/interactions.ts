import { BridgeError, errorValue } from '@dotx/shared/errors';
import { canonical } from '@dotx/shared/wire/commands';
import type { NativeEvent, NativeResponse } from '@dotx/shared/wire/commands';
import type { Method } from '../adapter.ts';
import { EventBuffer } from '../../events/buffer.ts';
import {
  Follows,
  targetKey,
  fTarget,
  turns,
  type FollowState,
  type FollowTarget,
} from './follows.ts';
import { createHash } from 'node:crypto';
import type { WireMessage } from './transport.ts';

export const responseMethods: Record<string, string> = {
  'item/commandExecution/requestApproval': 'thread-follower-command-approval-decision',
  'item/fileChange/requestApproval': 'thread-follower-file-approval-decision',
  'item/permissions/requestApproval': 'thread-follower-permissions-request-approval-response',
  'item/tool/requestUserInput': 'thread-follower-submit-user-input',
  'mcpServer/elicitation/request': 'thread-follower-submit-mcp-server-elicitation-response',
};
export const asyncMethod = 'request_user_input_async';
export const planMethod = 'item/plan/requestImplementation';
function* asyncQuestions(state: WireMessage) {
  for (const turn of turns(state))
    for (const item of turn.items ?? [])
      if (item.type === 'agentMessage' && item.delivery === 'async' && item.questions?.length)
        yield { turnId: turn.turnId, item };
}
export interface Interaction extends FollowTarget {
  key: string;
  owner: string;
  turnId?: string | null;
  native: Record<string, any>;
  responseSchema?: unknown;
  status: NonNullable<NativeEvent['response_status']>;
  eventId?: string;
  publishedState?: string;
  responseResult?: unknown;
  diagnostic?: NativeEvent['response_diagnostic'];
}
const identity = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export class Interactions {
  readonly following: Follows;
  readonly options: { events: EventBuffer; nativeCatalog: Method[] };
  readonly interactions = new Map<string, Interaction>();
  constructor(following: Follows, events: EventBuffer, nativeCatalog: Method[]) {
    this.following = following;
    this.options = { events, nativeCatalog };
  }
  get runtimeId() {
    return this.following.runtimeId;
  }
  emit(...args: Parameters<Follows['emit']>) {
    return this.following.emit(...args);
  }
  get(key: string) {
    return this.interactions.get(key) ?? null;
  }
  forTarget(target: FollowTarget) {
    return [...this.interactions.values()].filter((i) => targetKey(i) === targetKey(target));
  }
  record(i: Interaction) {
    const prior = this.interactions.get(i.key);
    if (!prior) this.interactions.set(i.key, i);
    else if (prior.status === 'pending') prior.owner = i.owner;
    return this.interactions.get(i.key)!;
  }
  decorate(event: NativeEvent): NativeEvent {
    const current = event.interaction_key && this.get(event.interaction_key);
    return current && current.eventId === event.event_id
      ? {
          ...event,
          response_status: current.status,
          response_result: current.responseResult,
          response_diagnostic: current.diagnostic,
        }
      : event;
  }
  release(row: Interaction) {
    // Keep the final response on the bounded event, not in a separate historical ledger.
    const event = row.eventId && this.options.events.event(row.eventId);
    if (event) Object.assign(event, this.decorate(event));
    this.interactions.delete(row.key);
  }
  observeState(f: FollowState, previous?: WireMessage) {
    const s = f.state!;
    const present = new Set<string>();
    const record = (i: Interaction) => {
      present.add(i.key);
      const current = this.record(i);
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
            response_diagnostic: current.diagnostic,
          },
        );
        current.eventId = event.event_id;
      }
      return current;
    };
    // PRIVATE CODEX API: requests[] mixes blocking requests with a desktop-generated Plan
    // continuation prompt. The latter appears after turn completion and has no response RPC.
    // For blocking requests, disappearance means answered OR cleared/cancelled, not completion.
    for (const request of s.requests ?? []) {
      const method = request.method;
      const turnId = request.params?.turnId;
      const key = identity([
        f.hostId,
        f.conversationId,
        turnId,
        method,
        request.id,
        request.params,
      ]);
      if (method === planMethod) {
        if (
          !previous?.requests?.some(
            (old: WireMessage) => old.method === method && old.id === request.id,
          ) &&
          !this.options.events.rows.some(
            (event) => event.runtime_id === this.runtimeId && event.interaction_key === key,
          )
        )
          this.emit({ ...request, params: { ...request.params, ...fTarget(f) } }, 'notification', {
            interaction_key: key,
          });
        continue;
      }
      const schema = this.options.nativeCatalog.find(
        (m) => m.name === method && m.kind === 'server_request',
      )?.output_schema;
      // Unsupported answers must not hide pending requests. Keep native state pending,
      // expose why DotX cannot answer, and let the caller arrange desktop interaction.
      const diagnostic = !responseMethods[method]
        ? {
            code: 'COORDINATION_RESPONSE_METHOD_UNSUPPORTED',
            message: `DotX has no desktop response mapping for ${method}. Handle this request in the desktop client.`,
          }
        : undefined;
      // Elicitation may be outside a turn. Request ID, method and original params still
      // identify its pending native handle; never guess a turn from the latest snapshot.
      record({
        key,
        hostId: f.hostId,
        conversationId: f.conversationId,
        owner: f.owner,
        turnId,
        native: request,
        responseSchema: schema,
        status: 'pending',
        diagnostic,
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
    for (const old of this.forTarget(f)) {
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
  }
  interaction(event: NativeEvent) {
    if (event.kind !== 'server_request') throw new BridgeError('SERVER_REQUEST_NOT_PENDING');
    const row = event.interaction_key && this.get(event.interaction_key);
    if (!row || row.eventId !== event.event_id) throw new BridgeError('SERVER_REQUEST_NOT_PENDING');
    const params = event.native.params as WireMessage | undefined;
    if (row.hostId !== params?.hostId || row.conversationId !== params?.conversationId)
      throw new BridgeError('INTERACTION_SOURCE_MISMATCH');
    if (row.status === 'pending' && row.diagnostic) throw row.diagnostic;
    return row;
  }
  async prepareResponse(event: NativeEvent, response: NativeResponse) {
    const row = this.interaction(event);
    if ('error' in response)
      throw new BridgeError(
        'COORDINATION_RESPONSE_REQUIRES_RESULT',
        'Use the native decision (including decline/cancel) or question answer; this desktop channel has no generic error response.',
      );
    const f = await this.following.snapshot(row);
    this.validatePending(row, f);
  }
  validatePending(row: Interaction, f: FollowState) {
    if (this.get(row.key)?.status !== 'pending')
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
    const f = this.following.follows.get(targetKey(row));
    if (!f?.state) throw new BridgeError('COORDINATION_SNAPSHOT_UNAVAILABLE');
    this.validatePending(row, f);
    Object.assign(row, { status: 'responding' });
    try {
      const method = responseMethods[row.native.method];
      const value = response.result as WireMessage;
      // Private desktop wrappers differ: command/file approvals carry decision; other requests
      // carry response. Local v1 / remote v2 is a wire convention, not inferred from CLI schema.
      const body = method.endsWith('-approval-decision')
        ? { decision: value?.decision }
        : { response: value };
      const params = { conversationId: row.conversationId, requestId: row.native.id, ...body };
      const reply = await this.following.wire.request(
        method,
        params,
        1 + (row.hostId === 'local' ? 0 : 1),
        f.owner,
        row.hostId,
      );
      if (reply.resultType !== 'success') throw reply.error;
      // A native snapshot may resolve and release this row before the RPC reply arrives.
      if (row.status === 'resolved') return { status: row.status };
      Object.assign(row, {
        status: 'submitted',
        responseResult: { native: reply.result, original_turn_id: row.turnId },
      });
      await this.following.snapshot(row);
      return { status: row.status };
    } catch (e) {
      const diagnostic = errorValue(e);
      // Resolution and an RPC failure can both be observed. Keep both facts.
      if (row.status === 'resolved') {
        event.response_diagnostic = diagnostic;
        return { status: 'resolved' as const, diagnostic };
      }
      Object.assign(row, {
        status: 'unknown',
        diagnostic,
      });
      throw e;
    }
  }
}
