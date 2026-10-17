import { ReleaseUpdates } from '../updates/discovery.ts';
import { z } from 'zod';
import { Coordinator } from '../state/coordinator.ts';
import { observationBatch } from '@dotx/shared/state';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { Events } from '../events/subscriptions.ts';
import type { EventStore } from '../events/subscriptions.ts';
import { eventAccess } from '../events/authorization.ts';
import { safeError } from '@dotx/shared/errors';
import type { Outcome } from '@dotx/shared/protocol';
import { Enrollment } from '../enrollment/service.ts';
import { heartbeatSchema, responseSchema } from '@dotx/shared/protocol';
import { gatewayCommand as commandSchema } from '@dotx/shared/gateway';
import { isCurrentHub } from './namespace.ts';
import type { Env } from '../env.ts';
import type { Heartbeat } from '@dotx/shared/protocol';
export interface SocketInfo extends Partial<Heartbeat> {
  deviceId: string;
  lastSeen: number;
  connectedAt?: number;
  protocol?: number;
}
export interface HubSocket {
  deserializeAttachment(): unknown;
  serializeAttachment(data: SocketInfo): void;
  send(data: string): void;
  close(code?: number): void;
}
export interface HubContext {
  id: Pick<DurableObjectId, 'jurisdiction' | 'toString'>;
  storage: EventStore;
  getWebSockets(tag?: string): HubSocket[];
  acceptWebSocket(socket: WebSocket, tags?: string[]): void;
}
const attachment = (socket: HubSocket): SocketInfo => socket.deserializeAttachment() as SocketInfo;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export class DeviceHub {
  readonly ctx: HubContext;
  readonly env: Partial<Env>;
  readonly events: Events;
  readonly coordinator: Coordinator;
  readonly enrollment: Enrollment;
  readonly updates: ReleaseUpdates;
  readonly pending = new Map<
    string,
    { socket: HubSocket; resolve: (value: Response) => void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(ctx: HubContext, env: Partial<Env>) {
    this.ctx = ctx;
    this.env = env;
    this.updates = new ReleaseUpdates(ctx.storage, env.RELEASE_REPOSITORY, env.RELEASE_CHANNEL);
    this.enrollment = new Enrollment(
      ctx.storage,
      env.OWNER_KEY_HASH ?? '',
      env.PUBLIC_ORIGIN ?? '',
    );
    this.events = new Events(ctx.storage, {
      authorized: async (auth, id) =>
        (await this.enrollment.devices()).some((d) => d.id === id) &&
        eventAccess(env as Env, auth, id),
      jurisdiction: ctx.id.jurisdiction,
    });
    this.coordinator = new Coordinator(
      ctx.storage,
      async (operation, args, id) =>
        (
          await this.fetch(
            new Request('https://hub/command', {
              method: 'POST',
              body: JSON.stringify({ operation, args, id }),
            }),
          )
        ).json<Outcome>(),
      this.events,
    );
  }
  sockets(deviceId: string) {
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
                diagnostic: { code: 'DEVICE_PROTOCOL_MISMATCH' },
              };
        return { socket, info };
      })
      .filter((x) => Date.now() - x.info?.lastSeen < 45000)
      .sort((a, b) => b.info.lastSeen - a.info.lastSeen);
  }
  discoverySockets(deviceId: string, nativeInterface?: string) {
    return this.sockets(deviceId)
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
  async fetch(request: Request): Promise<Response> {
    this.checkPlacement();
    const url = new URL(request.url);
    if (url.pathname === '/updates') return json(await this.updates.read());
    if (url.pathname === '/registry') return json(await this.enrollment.devices());
    if (url.pathname === '/setup' || url.pathname.startsWith('/setup/')) {
      const response = await this.enrollment.fetch(request);
      if (url.pathname === '/setup/revoke' && response.ok) {
        const { device_id } = await response.clone().json<{ device_id: string }>();
        for (const socket of this.ctx.getWebSockets(device_id)) socket.close(1008);
      }
      return response;
    }
    if (url.pathname === '/events') {
      try {
        const { auth, method, args } = await request.json<{
          auth: import('../events/subscriptions.ts').EventAuthority;
          method: string;
          args: unknown;
        }>();
        const result =
          method === 'status'
            ? await this.events.status(auth)
            : await this.events.invoke(auth, method, args);
        return json({ ok: true, result });
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code === -32015)
          return json({
            ok: false,
            error: {
              code: -32015,
              message: 'CallbackEndpointError',
              data: 'data' in e ? e.data : undefined,
            },
          });
        return json({ ok: false, error: safeError(e) });
      }
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
    if (url.pathname === '/devices')
      return json({
        devices: (await this.enrollment.devices()).map((d) => {
          const best = this.discoverySockets(d.id)[0] ?? this.sockets(d.id)[0];
          return {
            deviceId: d.id,
            label: d.label,
            availability: best?.info.availability || 'offline',
            targetHostId: 'local',
            connectorDeviceId: d.id,
            desktopVersion: best?.info.desktopVersion ?? null,
            connectorVersion: best?.info.connectorVersion ?? null,
            lastSeen: best?.info.lastSeen ?? null,
            diagnostic: best?.info.diagnostic ?? null,
            interfaces: best?.info.interfaces ?? [],
          };
        }),
        freshnessMs: 45000,
      });
    if (url.pathname === '/invoke') {
      try {
        const { operation, args, principal, devices } = z
          .object({
            operation: z.enum([
              'describe_methods',
              'call',
              'get_request',
              'read_events',
              'respond',
            ]),
            args: z.unknown(),
            principal: z.string(),
            devices: z.array(z.string()),
          })
          .parse(await request.json());
        const registered = await this.enrollment.devices();
        const allowed = devices.filter((id) => registered.some((d) => d.id === id));
        return json({
          ok: true,
          result: await this.coordinator.invoke({ principal, devices: allowed }, operation, args),
        });
      } catch (error) {
        return json({ ok: false, error: safeError(error) });
      }
    }
    if (url.pathname !== '/command') return json({ error: 'NOT_FOUND' }, 404);
    const body = await request.json<any>();
    const { operation, args: input } = commandSchema
      .omit({ type: true, protocol: true, id: true })
      .parse(body);
    const args = z
      .object({
        connection_id: z.string(),
        runtime_id: z.string().optional(),
        interface: z.string().optional(),
      })
      .passthrough()
      .parse(input);
    const live = this.sockets(args.connection_id);
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
        ? this.discoverySockets(args.connection_id, args.interface)[0]
        : operation === 'read_turn' || operation === 'resolve_turn'
          ? this.discoverySockets(
              args.connection_id,
              operation === 'read_turn' ? 'app_tools' : 'app_server',
            )[0]
          : compatible[0];
    if (!entry)
      return json({
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
      });
    const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
    return new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(
          json({
            ok: false,
            error: {
              code:
                operation === 'call' || operation === 'respond'
                  ? 'CALL_OUTCOME_UNKNOWN'
                  : 'DEVICE_TIMEOUT',
              message: 'Query get_request using the same request_id. No automatic resend.',
            },
          }),
        );
      }, 55000);
      this.pending.set(id, { socket: entry.socket, resolve, timer });
      try {
        entry.socket.send(
          JSON.stringify({ type: 'command', protocol: WIRE_VERSION, id, operation, args }),
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(json({ ok: false, error: { code: 'DEVICE_DISCONNECTED' } }));
      }
    });
  }
  async webSocketMessage(socket: HubSocket, data: string | ArrayBuffer) {
    this.checkPlacement();
    if (typeof data !== 'string' || data.length > 4 * 1024 * 1024) {
      socket.close(1009);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      socket.close(1003);
      return;
    }
    const batch = observationBatch.safeParse(raw);
    if (batch.success) {
      const info = attachment(socket);
      if (info.protocol !== WIRE_VERSION) {
        socket.close(1008);
        return;
      }
      try {
        const ids = await this.coordinator.observe(info.deviceId, batch.data.observations);
        socket.send(JSON.stringify({ type: 'observations_ack', ids }));
      } catch {
        socket.close(1011);
      }
      return;
    }
    const heartbeat = heartbeatSchema.safeParse(raw);
    const response = responseSchema.safeParse(raw);
    if (heartbeat.success) {
      const msg = heartbeat.data;
      const previous = attachment(socket);
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
        diagnostic:
          msg.protocol !== WIRE_VERSION
            ? { code: 'DEVICE_PROTOCOL_MISMATCH' }
            : msg.diagnostic
              ? { code: String(msg.diagnostic.code).slice(0, 100) }
              : null,
      });
      socket.send(JSON.stringify({ type: 'heartbeat_ack', protocol: WIRE_VERSION }));
      await this.restoreDevice(previous.deviceId);
    } else if (response.success) {
      const msg = response.data;
      const pending = this.pending.get(msg.id);
      if (pending && pending.socket !== socket) return;
      const info = attachment(socket);
      try {
        await this.coordinator.recordReply(msg.id, msg, {
          connection: info.deviceId,
          runtimes: (info.interfaces ?? []).map((i) => i.runtime_id),
        });
      } catch {
        return;
      }
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.resolve(json(msg));
    }
  }
  async restoreDevice(deviceId: string) {
    const state = await this.coordinator.restore(deviceId);
    const tools = this.discoverySockets(deviceId, 'app_tools')[0]?.socket;
    const coordination = this.discoverySockets(deviceId, 'client_coordination')[0]?.socket;
    for (const { socket } of this.discoverySockets(deviceId)) {
      try {
        socket.send(
          JSON.stringify({
            type: 'restore',
            protocol: WIRE_VERSION,
            tasks: socket === tools ? state.tasks : [],
            follows: socket === coordination ? state.follows : [],
          }),
        );
      } catch {
        /* next heartbeat restores observation only */
      }
    }
  }
  async alarm() {
    this.checkPlacement();
    await this.events.alarm();
  }
  checkPlacement() {
    if (!isCurrentHub(this.ctx.id, this.env)) throw new Error('HUB_IDENTITY_MISMATCH');
  }
  webSocketClose(socket: HubSocket) {
    this.disconnect(socket);
  }
  webSocketError(socket: HubSocket) {
    this.disconnect(socket);
  }
  disconnect(socket: HubSocket) {
    const info = attachment(socket);
    socket.serializeAttachment({ ...info, lastSeen: 0 });
    for (const [id, p] of this.pending)
      if (p.socket === socket) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve(
          json({
            ok: false,
            error: {
              code: 'CONNECTION_LOST_OUTCOME_UNKNOWN',
              message: 'Reconcile the same requestId after reconnect; do not resend.',
            },
          }),
        );
      }
    try {
      socket.close();
    } catch {}
  }
}
