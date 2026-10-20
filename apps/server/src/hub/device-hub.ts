import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { ReleaseUpdates } from '../updates/discovery.ts';
import { z } from 'zod';
import { Coordinator, type Authority } from '../state/coordinator.ts';
import { observationBatch, type DeviceOperation } from '@dotx/shared/state';
import { WIRE_VERSION, type GatewayOperation } from '@dotx/shared/gateway';
import { Events, type EventAuthority } from '../events/subscriptions.ts';
import { eventAccess } from '../events/authorization.ts';
import { errorCode, errorValue } from '@dotx/shared/errors';
import type { DeviceList, Outcome } from '@dotx/shared/protocol';
import { Enrollment } from '../enrollment/service.ts';
import { heartbeatSchema, responseSchema } from '@dotx/shared/protocol';
import type { Env } from '../env.ts';
import type { Heartbeat } from '@dotx/shared/protocol';
export interface SocketInfo extends Partial<Heartbeat> {
  deviceId: string;
  lastSeen: number;
  connectedAt?: number;
  protocol?: number;
}
const attachment = (socket: WebSocket): SocketInfo => socket.deserializeAttachment() as SocketInfo;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export class DeviceHub extends DurableObject<Env> {
  readonly #events: Events;
  readonly #coordinator: Coordinator;
  readonly #enrollment: Enrollment;
  readonly #updates: ReleaseUpdates;
  readonly #pending = new Map<
    string,
    {
      socket: WebSocket;
      recordsReply: boolean;
      resolve: (value: Outcome) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#updates = new ReleaseUpdates(ctx.storage, env.RELEASE_REPOSITORY, env.RELEASE_CHANNEL);
    this.#enrollment = new Enrollment(
      ctx.storage,
      env.OWNER_KEY_HASH ?? '',
      env.PUBLIC_ORIGIN ?? '',
    );
    this.#events = new Events(ctx.storage, {
      waitUntil: (work) => ctx.waitUntil(work),
      authorized: async (auth, id) =>
        (await this.#enrollment.devices()).some((d) => d.id === id) && eventAccess(env, auth, id),
      resolveTurn: (auth, args, inspect) =>
        this.#coordinator.eventTurn({ principal: 'owner', devices: auth.devices }, args, inspect),
    });
    this.#coordinator = new Coordinator(
      ctx.storage,
      (operation, args, id) => this.#dispatch(operation, args, id),
      this.#events,
    );
  }
  #sockets(deviceId: string) {
    return this.ctx
      .getWebSockets(deviceId)
      .map((socket) => {
        const saved = attachment(socket);
        const info: SocketInfo =
          saved.protocol === WIRE_VERSION
            ? saved
            : {
                ...saved,
                availability: 'unavailable',
              };
        return { socket, info };
      })
      .filter((x) => Date.now() - x.info?.lastSeen < 45000)
      .sort((a, b) => b.info.lastSeen - a.info.lastSeen);
  }
  #discoverySockets(deviceId: string, nativeInterface?: string) {
    return this.#sockets(deviceId)
      .filter((x) => x.info.protocol === WIRE_VERSION)
      .sort((a, b) => {
        const online = (info: SocketInfo) =>
          nativeInterface
            ? Boolean(
                info.interfaces?.some(
                  (i) => i.name === nativeInterface && i.availability === 'online',
                ),
              )
            : info.availability === 'online';
        return (
          Number(online(b.info)) - Number(online(a.info)) ||
          (a.info.connectedAt ?? a.info.lastSeen) - (b.info.connectedAt ?? b.info.lastSeen)
        );
      });
  }
  #failure(code: string, cause: unknown) {
    const error = { code, cause: errorValue(cause) };
    // Failure details stay in logs/responses, never heartbeat attachments.
    // Do not log the command, native reply or authorization headers.
    console.error('dotx', error);
    return error;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/setup' || url.pathname.startsWith('/setup/')) {
      const response = await this.#enrollment.fetch(request);
      if (url.pathname === '/setup/revoke' && response.ok) {
        const { device_id } = await response.clone().json<{ device_id: string }>();
        for (const socket of this.ctx.getWebSockets(device_id)) socket.close(1008);
      }
      return response;
    }
    if (url.pathname === '/connect') {
      const deviceId = request.headers.get('X-Device-Id');
      if (!deviceId) return json({ error: 'MISSING_DEVICE_ID' }, 400);
      const pair = new WebSocketPair();
      pair[1].serializeAttachment({
        deviceId,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        availability: 'unavailable',
      });
      this.ctx.acceptWebSocket(pair[1], [deviceId]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
  async registry() {
    return this.#enrollment.devices();
  }
  async connectionSummary(auth: EventAuthority) {
    const result = await this.#deviceList();
    const updates = await this.#updates.read();
    let events: Outcome<object>;
    try {
      events = { ok: true, result: await this.#events.status(auth) };
    } catch (error) {
      events = { ok: false, error: errorValue(error) };
    }
    return { result, updates, events, service: await this.#enrollment.info() };
  }
  async eventRequest(
    auth: EventAuthority,
    method: string,
    args: unknown,
  ): Promise<Outcome<object>> {
    try {
      return { ok: true, result: await this.#events.invoke(auth, method, args) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === -32015)
        return {
          ok: false,
          error: {
            code: -32015,
            message: 'CallbackEndpointError',
            data: 'data' in error ? error.data : undefined,
          },
        };
      return { ok: false, error: errorValue(error) };
    }
  }
  async invoke(
    auth: Authority,
    operation: GatewayOperation,
    args: unknown,
  ): Promise<Outcome<Record<string, unknown>>> {
    try {
      const registered = await this.#enrollment.devices();
      const devices = auth.devices.filter((id) => registered.some((d) => d.id === id));
      return {
        ok: true,
        result: await this.#coordinator.invoke(
          { principal: auth.principal, devices },
          operation,
          args,
        ),
      };
    } catch (error) {
      // RPC exceptions do not retain arbitrary error properties. Keep native and
      // validation errors in the same data envelope used by the MCP boundary.
      return { ok: false, error: errorValue(error) };
    }
  }
  async #deviceList(): Promise<DeviceList> {
    return {
      devices: (await this.#enrollment.devices()).map((d) => {
        const best = this.#discoverySockets(d.id)[0] ?? this.#sockets(d.id)[0];
        return {
          deviceId: d.id,
          label: d.label,
          availability: best?.info.availability || 'offline',
          targetHostId: 'local',
          connectorDeviceId: d.id,
          desktopVersion: best?.info.desktopVersion ?? null,
          connectorVersion: best?.info.connectorVersion ?? null,
          lastSeen: best?.info.lastSeen ?? null,
          diagnostic:
            best && best.info.protocol !== WIRE_VERSION
              ? { code: 'DEVICE_PROTOCOL_MISMATCH' }
              : null,
          interfaces: best?.info.interfaces ?? [],
        };
      }),
      freshnessMs: 45000,
    };
  }
  async #dispatch(
    operation: DeviceOperation,
    input: Record<string, unknown>,
    id: string = crypto.randomUUID(),
  ): Promise<Outcome> {
    const args = z
      .object({
        connection_id: z.string(),
        runtime_id: z.string().optional(),
        interface: z.string().optional(),
      })
      .passthrough()
      .parse(input);
    const live = this.#sockets(args.connection_id);
    const pinned = operation === 'call' || operation === 'respond' || operation === 'read_events';
    const compatible = live.filter((x) => x.info.protocol === WIRE_VERSION);
    const entry = pinned
      ? (compatible.find((x) =>
          x.info.interfaces?.some(
            (i) =>
              i.runtime_id === args.runtime_id &&
              i.name === args.interface &&
              i.availability === 'online',
          ),
        ) ?? undefined)
      : operation === 'describe_methods'
        ? this.#discoverySockets(args.connection_id, args.interface)[0]
        : ['read_turn', 'inspect_turn', 'read_turn_result', 'resolve_turn'].includes(operation)
          ? this.#discoverySockets(
              args.connection_id,
              operation === 'read_turn' || operation === 'inspect_turn'
                ? 'client_coordination'
                : 'app_server',
            )[0]
          : compatible[0];
    if (!entry)
      return {
        ok: false,
        error: {
          code: !live.length
            ? 'DEVICE_OFFLINE'
            : pinned && compatible.length
              ? compatible.some((x) =>
                  x.info.interfaces?.some(
                    (i) => i.runtime_id === args.runtime_id && i.name === args.interface,
                  ),
                )
                ? 'INTERFACE_UNAVAILABLE'
                : 'RUNTIME_CHANGED'
              : 'DEVICE_UNAVAILABLE',
        },
      };
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({
          ok: false,
          error: {
            code:
              operation === 'call' || operation === 'respond'
                ? 'CALL_OUTCOME_UNKNOWN'
                : 'DEVICE_TIMEOUT',
            message:
              operation === 'call' && args.request_id
                ? 'Query get_request using the same request_id. No automatic resend.'
                : 'No automatic resend. Check current native state before repeating a side-effecting operation.',
          },
        });
      }, DEFAULT_TIMEOUT_MS);
      this.#pending.set(id, {
        socket: entry.socket,
        recordsReply:
          (operation === 'call' && typeof args.request_id === 'string') || operation === 'respond',
        resolve,
        timer,
      });
      try {
        entry.socket.send(
          JSON.stringify({ type: 'command', protocol: WIRE_VERSION, id, operation, args }),
        );
      } catch (cause) {
        clearTimeout(timer);
        this.#pending.delete(id);
        resolve({ ok: false, error: this.#failure('DEVICE_DISCONNECTED', cause) });
      }
    });
  }
  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string') {
      this.#disconnect(socket, this.#failure('INVALID_DEVICE_MESSAGE', { type: 'binary' }), 1003);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch (cause) {
      this.#disconnect(socket, this.#failure('INVALID_DEVICE_MESSAGE', cause), 1003);
      return;
    }
    const batch = observationBatch.safeParse(raw);
    if (batch.success) {
      const info = attachment(socket);
      if (info.protocol !== WIRE_VERSION) {
        this.#disconnect(
          socket,
          this.#failure('DEVICE_PROTOCOL_MISMATCH', {
            expected: WIRE_VERSION,
            received: info.protocol,
          }),
          1008,
        );
        return;
      }
      try {
        const ids = await this.#coordinator.observe(info.deviceId, batch.data.observations);
        socket.send(JSON.stringify({ type: 'observations_ack', ids }));
      } catch (cause) {
        this.#disconnect(socket, this.#failure('DEVICE_OBSERVATION_FAILED', cause), 1011);
      }
      return;
    }
    const heartbeat = heartbeatSchema.safeParse(raw);
    const response = responseSchema.safeParse(raw);
    if (heartbeat.success) {
      const msg = heartbeat.data;
      const previous = attachment(socket);
      // Close can lag behind handoff. A queued heartbeat must not revive a retired socket.
      if (previous.lastSeen === 0) return;
      socket.serializeAttachment({
        deviceId: previous.deviceId,
        connectedAt: previous.connectedAt ?? Date.now(),
        protocol: msg.protocol,
        lastSeen: Date.now(),
        availability:
          msg.protocol === WIRE_VERSION && msg.availability === 'online' ? 'online' : 'unavailable',
        interfaces: msg.interfaces,
        desktopVersion: String(msg.desktopVersion || '').slice(0, 100),
        connectorVersion: String(msg.connectorVersion || '').slice(0, 100),
      });
      if (msg.protocol === WIRE_VERSION && msg.availability === 'online') {
        for (const other of this.ctx.getWebSockets(previous.deviceId)) {
          const info = attachment(other);
          if (
            other !== socket &&
            info.lastSeen !== 0 &&
            (info.connectedAt ?? 0) <= (previous.connectedAt ?? 0)
          )
            // Reuse disconnect semantics for pending RPCs; never dispatch them again.
            this.#disconnect(other, { code: 'CONNECTION_REPLACED' }, 1000);
        }
      }
      socket.send(JSON.stringify({ type: 'heartbeat_ack', protocol: WIRE_VERSION }));
    } else if (response.success) {
      const msg = response.data;
      const pending = this.#pending.get(msg.id);
      if (pending && pending.socket !== socket) {
        this.#failure('REPLY_SOURCE_MISMATCH', { request_id: msg.id });
        return;
      }
      const info = attachment(socket);
      let reply: Outcome = msg;
      try {
        // Live ordinary queries have no durable receipt. A late reply can still
        // belong to a timed-out write, so reconcile it when no waiter remains.
        if (!pending || pending.recordsReply)
          await this.#coordinator.recordReply(msg.id, msg, {
            connection: info.deviceId,
            runtimes: (info.interfaces ?? []).map((i) => i.runtime_id),
          });
      } catch (cause) {
        // An unrelated source must not complete another connector's pending call.
        if (errorCode(cause) === 'REPLY_SOURCE_MISMATCH') {
          this.#failure('REPLY_SOURCE_MISMATCH', cause);
          return;
        }
        // Receipt processing or persistence failed after receiving a reply.
        // This is an unknown outcome, not rejection or permission to send again.
        reply = { ok: false, error: this.#failure('REPLY_RECORD_FAILED', cause) };
      }
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(msg.id);
      pending.resolve(reply);
    } else {
      const type = raw && typeof raw === 'object' && 'type' in raw ? raw.type : undefined;
      const invalid =
        type === 'heartbeat'
          ? heartbeat
          : type === 'response'
            ? response
            : type === 'observations'
              ? batch
              : undefined;
      if (invalid && !invalid.success)
        this.#disconnect(socket, this.#failure('INVALID_DEVICE_MESSAGE', invalid.error), 1003);
    }
  }
  async alarm() {
    await this.#events.alarm();
  }
  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.#disconnect(socket, { code, reason, wasClean });
  }
  webSocketError(socket: WebSocket, cause: unknown) {
    this.#disconnect(socket, this.#failure('DEVICE_WEBSOCKET_FAILED', cause));
  }
  #disconnect(socket: WebSocket, cause?: unknown, closeCode?: number) {
    const info = attachment(socket);
    socket.serializeAttachment({ ...info, lastSeen: 0 });
    for (const [id, p] of this.#pending)
      if (p.socket === socket) {
        clearTimeout(p.timer);
        this.#pending.delete(id);
        p.resolve({
          ok: false,
          error: {
            code: 'CONNECTION_LOST_OUTCOME_UNKNOWN',
            message: 'Reconcile the same requestId after reconnect; do not resend.',
            ...(cause === undefined ? {} : { cause: errorValue(cause) }),
          },
        });
      }
    try {
      socket.close(closeCode);
    } catch {}
  }
}
