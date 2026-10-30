import { z } from 'zod';
import { BridgeError } from '@dotx/shared/errors';
import type { Call, NativeEvent, NativeResponse } from '@dotx/shared/wire/commands';
import type { Adapter, Method } from '../adapter.ts';
import {
  Follows,
  targetKey,
  turns,
  type FollowOptions,
  type FollowState,
  type FollowTarget,
} from './follows.ts';
import { Interactions, responseMethods, planMethod, asyncMethod } from './interactions.ts';

const targetSchema = z.object({
  hostId: z.string().min(1).default('local'),
  conversationId: z.string().min(1),
});
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
export class CoordinationAdapter implements Adapter {
  readonly options: Omit<FollowOptions, 'onSnapshot' | 'onClear'> & { nativeCatalog: Method[] };
  readonly following: Follows;
  readonly interactions: Interactions;
  constructor(options: CoordinationAdapter['options']) {
    this.options = options;
    this.following = new Follows({
      ...options,
      onSnapshot: (...args) => this.interactions.observeState(...args),
      onClear: () => this.interactions.interactions.clear(),
    });
    this.interactions = new Interactions(this.following, options.events, options.nativeCatalog);
  }
  status() {
    return this.following.status();
  }
  current(target: FollowTarget) {
    const state = this.following.follows.get(targetKey(target));
    return state?.state ? this.summary(state) : undefined;
  }
  async read(target: FollowTarget) {
    return this.summary(await this.following.snapshot(target));
  }
  decorateEvent(event: NativeEvent) {
    return this.interactions.decorate(event);
  }
  prepareResponse(event: NativeEvent, response: NativeResponse) {
    return this.interactions.prepareResponse(event, response);
  }
  respond(event: NativeEvent, response: NativeResponse) {
    return this.interactions.respond(event, response);
  }
  close() {
    this.following.close();
  }
  async methods(): Promise<Method[]> {
    await this.following.connect();
    // PRIVATE CODEX API: borrow known App Server fields as discovery hints, not as the
    // desktop settings contract. The owner validates parameters; read back applied settings.
    const nativeSettings: any = this.options.nativeCatalog.find(
      (m) => m.name === 'thread/settings/update',
    )?.input_schema;
    const properties = { ...nativeSettings?.properties };
    delete properties.threadId;
    const settings = { type: 'object', properties };
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
          type: 'object',
          properties: {
            ...targetProperties,
            threadSettings: settings,
            activeTurnId: { type: 'string' },
            condition: { type: 'object' },
          },
          required: ['conversationId', 'threadSettings'],
          definitions: nativeSettings?.definitions ?? {},
        },
        description:
          'Update settings at the actual desktop owner. Permissions apply to subsequent turns. Use only the user-selected scope. Tested permission profiles: :workspace with on-request; :danger-full-access with never. For permission changes, inspect a fresh following snapshot before sending real work. Fast is best effort; a tier mismatch alone must not interrupt or restart work. Raw native applied=true is not task completion.',
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
        name: planMethod,
        kind: 'notification',
        input_schema: { type: 'object' },
        description:
          'Desktop continuation prompt after a completed Plan turn, not a blocking request. After confirmation, switch collaborationMode to default and send an implementation message as a new turn. Do not use respond.',
      },
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
  summary(f: FollowState) {
    const s = f.state!;
    return {
      hostId: f.hostId,
      conversationId: f.conversationId,
      latestThreadSettings: s.latestThreadSettings,
      currentPermissions: s.currentPermissions,
      threadRuntimeStatus: s.threadRuntimeStatus,
      turns: turns(s).map((t) => ({ turnId: t.turnId, status: t.status, error: t.error })),
      interactions: this.interactions.forTarget(f).map((i) => ({
        interaction_key: i.key,
        event_id: i.eventId,
        method: i.native.method,
        turnId: i.turnId,
        status: i.status,
        response_result: i.responseResult,
        response_diagnostic: i.diagnostic,
      })),
    };
  }
  async call(method: string, params: Call['params']): Promise<NativeResponse> {
    const target = targetSchema.parse(params);
    if (method === 'thread-owner-discovery') return { result: await this.following.owner(target) };
    if (method === 'thread-stream-following-changed') {
      const following = z.boolean().parse(params!.following);
      if (!following) {
        const old = this.following.follows.get(targetKey(target));
        if (old) this.following.wire.follow(target.hostId, target.conversationId, old.owner, false);
        for (const row of this.interactions.forTarget(target)) {
          row.status = 'expired';
          this.interactions.release(row);
        }
        this.following.follows.delete(targetKey(target));
        this.options.onState?.(target);
        return { result: { ...target, following: false } };
      }
      return {
        result: { following: true, ...this.summary(await this.following.snapshot(target)) },
      };
    }
    if (method === 'thread-follower-update-thread-settings') {
      const f = await this.following.snapshot(target);
      const { hostId: _host, ...nativeParams } = params!;
      // Private settings RPC uses v2 locally, v3 for host routing. applied only acknowledges
      // the setting update; a running turn or later App Tools send may keep/replace its values.
      const reply = await this.following.wire.request(
        method,
        nativeParams,
        2 + (target.hostId === 'local' ? 0 : 1),
        f.owner,
        target.hostId,
      );
      return reply.resultType === 'success' ? { result: reply.result } : { error: reply.error };
    }
    throw new BridgeError('NATIVE_METHOD_NOT_FOUND');
  }
}
