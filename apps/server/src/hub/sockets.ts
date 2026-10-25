import { z } from 'zod';
import { deviceHello, proofMessage } from '@dotx/shared/wire/authentication';
import type {
  DeviceHello,
  DeviceChallenge,
  ConnectionError,
} from '@dotx/shared/wire/authentication';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { heartbeatSchema, responseSchema } from '@dotx/shared/wire/messages';
import { observationBatch } from '@dotx/shared/wire/observations';
import type { Observation } from '@dotx/shared/wire/observations';
import type { DeviceOperation, Outcome } from '@dotx/shared/requests';
import type { DeviceInfo, Heartbeat } from '@dotx/shared/devices';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { errorCode, errorValue } from '@dotx/shared/errors';
import { verifyProof } from '../devices/proof.ts';
import { randomSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';
import type { Env } from '../env.ts';
import type { Devices, DeviceRecord } from './devices.ts';
import packageInfo from '../../package.json' with { type: 'json' };
interface SocketInfo extends DeviceHello, Partial<Heartbeat> {
  socket_id: string;
  challenge: string;
  expires_at: number;
  consumed: boolean;
  authenticated: boolean;
  approved: boolean;
  retired: boolean;
  lastSeen: number;
}
interface Sequence {
  generation: number;
  attempt: number;
  socket_id: string;
}
const saved = (socket: WebSocket) => socket.deserializeAttachment() as SocketInfo;
const sequenceKey = (id: string) => 'device-sequence:' + id;
const diagnosticKey = (id: string) => 'device-diagnostic:' + id;
const freshness = 45_000;
interface Callbacks {
  observe: (device: string, observations: Observation[]) => Promise<string[]>;
  recordReply: (
    id: string,
    value: Outcome,
    source: { connection: string; runtimes: string[] },
  ) => Promise<unknown>;
}
export class Sockets {
  private promoting: Promise<void> = Promise.resolve();
  readonly ctx: DurableObjectState;
  readonly env: Env;
  readonly devices: Devices;
  readonly callbacks: Callbacks;
  readonly pending = new Map<
    string,
    {
      socket: WebSocket;
      recordsReply: boolean;
      resolve: (value: Outcome) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(ctx: DurableObjectState, env: Env, devices: Devices, callbacks: Callbacks) {
    this.ctx = ctx;
    this.env = env;
    this.devices = devices;
    this.callbacks = callbacks;
  }
  error(info: SocketInfo, code: string, message = code): ConnectionError {
    return {
      type: 'connection_error',
      code,
      message,
      device_id: info.device_id,
      desktop_version: info.desktop_version,
      desktop_wire_protocol: info.wire_protocol,
      server_version: packageInfo.version,
      server_wire_protocol: WIRE_VERSION,
      guide_url: `https://github.com/Vizards/DotX/blob/v${packageInfo.version}/docs/maintenance/update.md`,
    };
  }
  disconnect(socket: WebSocket, error: unknown, code = 1011) {
    const info = saved(socket);
    if (info.retired) return;
    socket.serializeAttachment({ ...info, retired: true, lastSeen: 0 });
    try {
      socket.send(JSON.stringify(error));
    } catch {}
    for (const [id, waiter] of this.pending)
      if (waiter.socket === socket) {
        clearTimeout(waiter.timer);
        this.pending.delete(id);
        waiter.resolve({
          ok: false,
          error: {
            code: 'CONNECTION_LOST_OUTCOME_UNKNOWN',
            cause: error,
            message:
              'Read current native state or the same request_id; do not resend automatically.',
          },
        });
      }
    try {
      socket.close(code);
    } catch {}
  }
  async connect(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      throw new HttpError(426, 'WEBSOCKET_REQUIRED');
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = deviceHello.safeParse({
      ...query,
      generation: Number(query.generation),
      attempt: Number(query.attempt),
      wire_protocol: Number(query.wire_protocol),
    });
    if (!parsed.success) throw new HttpError(400, 'INVALID_DEVICE_HELLO');
    const hello = parsed.data,
      device = await this.devices.get(hello.device_id);
    if (!device || device.key_id !== hello.key_id)
      throw new HttpError(401, 'DEVICE_IDENTITY_UNKNOWN');
    if (!['pending', 'approved'].includes(device.status))
      throw new HttpError(403, 'DEVICE_NOT_AUTHORIZED');
    const socket_id = crypto.randomUUID(),
      expires_at = Date.now() + DEFAULT_TIMEOUT_MS;
    const challenge: DeviceChallenge = {
      ...hello,
      purpose: 'dotx-device-auth',
      origin: this.env.PUBLIC_ORIGIN,
      service_id: this.env.SERVICE_ID,
      socket_id,
      server_version: packageInfo.version,
      server_wire_protocol: WIRE_VERSION,
      nonce: randomSecret(),
      expires_at,
    };
    const pair = new WebSocketPair(),
      server = pair[1],
      text = JSON.stringify(challenge);
    const info: SocketInfo = {
      ...hello,
      socket_id,
      challenge: text,
      expires_at,
      consumed: false,
      authenticated: false,
      approved: false,
      retired: false,
      lastSeen: Date.now(),
    };
    server.serializeAttachment(info);
    this.ctx.acceptWebSocket(server, [hello.device_id]);
    server.send(JSON.stringify({ type: 'challenge', challenge: text }));
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > expires_at) await this.ctx.storage.setAlarm(expires_at);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async current(deviceId: string) {
    const latest = await this.ctx.storage.get<Sequence>(sequenceKey(deviceId));
    if (!latest) return undefined;
    return this.ctx.getWebSockets(deviceId).find((socket) => {
      const info = saved(socket);
      return (
        info.socket_id === latest.socket_id && info.authenticated && info.approved && !info.retired
      );
    });
  }
  async mismatch(socket: WebSocket) {
    const info = saved(socket);
    const error = this.error(
      info,
      'DEVICE_PROTOCOL_MISMATCH',
      'Update the incompatible component; this connector will reconnect with backoff.',
    );
    try {
      const current = await this.current(info.device_id),
        live = current ? saved(current) : undefined;
      if (!live || live.wire_protocol !== WIRE_VERSION || Date.now() - live.lastSeen >= freshness)
        await this.ctx.storage.put(diagnosticKey(info.device_id), error);
    } catch {
      // A diagnostic storage failure must not keep an incompatible socket open.
    }
    this.disconnect(socket, error, 4004);
  }
  promote(socket: WebSocket) {
    const work = this.promoting.then(() => this.acceptCandidate(socket));
    this.promoting = work.catch(() => {});
    return work;
  }
  private async acceptCandidate(socket: WebSocket) {
    let info = saved(socket);
    if (info.retired || !info.authenticated) return;
    if (info.wire_protocol !== WIRE_VERSION) {
      await this.mismatch(socket);
      return;
    }
    const result = await this.ctx.storage.transaction(async (tx) => {
      const device = await this.devices.get(info.device_id, tx);
      if (
        !device ||
        device.key_id !== info.key_id ||
        !['approved', 'pending'].includes(device.status)
      )
        return 'denied';
      if (device.status === 'pending') return 'pending';
      const last = await tx.get<Sequence>(sequenceKey(info.device_id));
      if (
        last &&
        (last.generation > info.generation ||
          (last.generation === info.generation && last.attempt >= info.attempt))
      )
        return last.socket_id === info.socket_id ? 'approved' : 'stale';
      await tx.put(sequenceKey(info.device_id), {
        generation: info.generation,
        attempt: info.attempt,
        socket_id: info.socket_id,
      });
      await tx.delete(diagnosticKey(info.device_id));
      return 'approved';
    });
    info = saved(socket);
    if (info.retired) return;
    if (result === 'denied') {
      this.disconnect(socket, this.error(info, 'DEVICE_NOT_AUTHORIZED'), 4001);
      return;
    }
    if (result === 'stale') {
      this.disconnect(socket, this.error(info, 'CONNECTION_STALE'), 4003);
      return;
    }
    socket.serializeAttachment({ ...info, approved: result === 'approved' });
    if (result === 'approved')
      for (const old of this.ctx.getWebSockets(info.device_id))
        if (old !== socket) {
          const prior = saved(old);
          if (prior.approved && !prior.retired)
            this.disconnect(old, this.error(prior, 'CONNECTION_REPLACED'), 4002);
        }
    try {
      socket.send(
        JSON.stringify({
          type: 'authenticated',
          status: result,
          socket_id: info.socket_id,
          server_version: packageInfo.version,
          server_wire_protocol: WIRE_VERSION,
        }),
      );
    } catch {
      this.disconnect(socket, this.error(info, 'DEVICE_DISCONNECTED'));
    }
  }
  async changed(deviceId: string) {
    for (const socket of this.ctx.getWebSockets(deviceId)) {
      const info = saved(socket);
      if (info.authenticated && !info.retired) await this.promote(socket);
    }
  }
  async authenticated(socket: WebSocket, requireApproval: boolean) {
    const info = saved(socket);
    if (info.retired || !info.authenticated) return false;
    if (info.wire_protocol !== WIRE_VERSION) {
      await this.mismatch(socket);
      return false;
    }
    const device = await this.devices.get(info.device_id);
    if (
      !device ||
      device.key_id !== info.key_id ||
      !['pending', 'approved'].includes(device.status)
    ) {
      this.disconnect(socket, this.error(info, 'DEVICE_NOT_AUTHORIZED'), 4001);
      return false;
    }
    if (saved(socket).retired) return false;
    if (!info.approved) return !requireApproval && device.status === 'pending';
    if (device.status !== 'approved' || (await this.current(info.device_id)) !== socket)
      return false;
    return !saved(socket).retired;
  }
  async info(device: DeviceRecord): Promise<DeviceInfo> {
    const socket = await this.current(device.device_id);
    if (socket && saved(socket).wire_protocol !== WIRE_VERSION) await this.mismatch(socket);
    const entry = socket && !saved(socket).retired ? saved(socket) : undefined;
    const diagnostic = await this.ctx.storage.get<ConnectionError>(diagnosticKey(device.device_id));
    return {
      deviceId: device.device_id,
      label: device.name,
      availability:
        entry && Date.now() - entry.lastSeen < freshness
          ? (entry.availability ?? 'unavailable')
          : 'offline',
      desktopVersion: entry?.desktopVersion ?? null,
      connectorVersion: entry?.desktop_version ?? diagnostic?.desktop_version ?? null,
      lastSeen: entry?.lastSeen ?? null,
      diagnostic: diagnostic ?? null,
      interfaces: entry?.interfaces ?? [],
    };
  }
  async dispatch(
    operation: DeviceOperation,
    input: Record<string, unknown>,
    id = crypto.randomUUID(),
    authorize?: () => Promise<void>,
  ): Promise<Outcome> {
    const args = z
      .object({
        connection_id: z.string(),
        runtime_id: z.string().optional(),
        interface: z.string().optional(),
      })
      .passthrough()
      .parse(input);
    await authorize?.();
    const socket = await this.current(args.connection_id);
    if (!socket || !(await this.authenticated(socket, true))) {
      const diagnostic = await this.ctx.storage.get<ConnectionError>(
        diagnosticKey(args.connection_id),
      );
      return { ok: false, error: diagnostic ?? { code: 'DEVICE_OFFLINE' } };
    }
    const info = saved(socket);
    if (Date.now() - info.lastSeen >= freshness)
      return { ok: false, error: { code: 'DEVICE_OFFLINE' } };
    if (['call', 'respond', 'read_events'].includes(operation)) {
      const native = info.interfaces?.find(
        (i) => i.runtime_id === args.runtime_id && i.name === args.interface,
      );
      if (!native) return { ok: false, error: { code: 'RUNTIME_CHANGED' } };
      if (native.availability !== 'online')
        return { ok: false, error: { code: 'INTERFACE_UNAVAILABLE' } };
    }
    // No await between the last ownership/version check and enqueue/send.
    if (saved(socket).retired || info.wire_protocol !== WIRE_VERSION)
      return { ok: false, error: { code: 'DEVICE_UNAVAILABLE' } };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false,
          error: {
            code:
              operation === 'call' || operation === 'respond'
                ? 'CALL_OUTCOME_UNKNOWN'
                : 'DEVICE_TIMEOUT',
            message: 'Read current native state or the same request_id; no automatic resend.',
          },
        });
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, {
        socket,
        recordsReply:
          (operation === 'call' && typeof args.request_id === 'string') || operation === 'respond',
        resolve,
        timer,
      });
      try {
        socket.send(
          JSON.stringify({ type: 'command', protocol: WIRE_VERSION, id, operation, args }),
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, error: { code: 'DEVICE_DISCONNECTED' } });
      }
    });
  }
  async message(socket: WebSocket, data: string | ArrayBuffer) {
    let info = saved(socket);
    if (info.retired) return;
    if (typeof data !== 'string') {
      this.disconnect(socket, this.error(info, 'INVALID_DEVICE_MESSAGE'), 4005);
      return;
    }
    if (!info.authenticated) {
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        this.disconnect(socket, this.error(info, 'INVALID_DEVICE_PROOF'), 4005);
        return;
      }
      const proof = proofMessage.safeParse(raw);
      if (info.consumed || Date.now() >= info.expires_at || !proof.success) {
        this.disconnect(socket, this.error(info, 'INVALID_DEVICE_PROOF'), 4005);
        return;
      }
      socket.serializeAttachment({ ...info, consumed: true });
      const device = await this.devices.get(info.device_id);
      if (
        !device ||
        !(await verifyProof(proof.data.proof, info.challenge, device.public_key, info.key_id))
      ) {
        this.disconnect(socket, this.error(info, 'INVALID_DEVICE_PROOF'), 4005);
        return;
      }
      info = saved(socket);
      if (info.retired || Date.now() >= info.expires_at) return;
      socket.serializeAttachment({ ...info, authenticated: true, lastSeen: Date.now() });
      await this.promote(socket);
      return;
    }
    // Version/ownership gate runs before parsing any business wire payload.
    if (!(await this.authenticated(socket, false))) return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      this.disconnect(socket, this.error(info, 'INVALID_DEVICE_MESSAGE'), 4005);
      return;
    }
    const heartbeat = heartbeatSchema.safeParse(raw);
    if (heartbeat.success) {
      if (heartbeat.data.protocol !== info.wire_protocol) {
        this.disconnect(socket, this.error(info, 'SESSION_VERSION_CHANGED'), 4005);
        return;
      }
      const current = saved(socket);
      if (current.retired) return;
      socket.serializeAttachment({
        ...current,
        lastSeen: Date.now(),
        availability: heartbeat.data.availability === 'online' ? 'online' : 'unavailable',
        interfaces: heartbeat.data.interfaces,
        desktopVersion: heartbeat.data.desktopVersion,
      });
      socket.send(JSON.stringify({ type: 'heartbeat_ack', protocol: WIRE_VERSION }));
      return;
    }
    if (!(await this.authenticated(socket, true))) return;
    const batch = observationBatch.safeParse(raw);
    if (batch.success) {
      try {
        const ids = await this.callbacks.observe(info.device_id, batch.data.observations);
        if (await this.authenticated(socket, true))
          socket.send(JSON.stringify({ type: 'observations_ack', ids }));
      } catch {
        this.disconnect(socket, this.error(info, 'DEVICE_OBSERVATION_FAILED'));
      }
      return;
    }
    const response = responseSchema.safeParse(raw);
    if (response.success) {
      const reply = response.data,
        waiter = this.pending.get(reply.id);
      if (waiter && waiter.socket !== socket) return;
      let result: Outcome = reply;
      try {
        if (!waiter || waiter.recordsReply)
          await this.callbacks.recordReply(reply.id, reply, {
            connection: info.device_id,
            runtimes: (saved(socket).interfaces ?? []).map((i) => i.runtime_id),
          });
      } catch (error) {
        if (errorCode(error) === 'REPLY_SOURCE_MISMATCH') return;
        result = { ok: false, error: { code: 'REPLY_RECORD_FAILED', cause: errorValue(error) } };
      }
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(reply.id);
      waiter.resolve(result);
      return;
    }
    this.disconnect(socket, this.error(info, 'INVALID_DEVICE_MESSAGE'), 4005);
  }
  close(socket: WebSocket) {
    this.disconnect(socket, this.error(saved(socket), 'DEVICE_DISCONNECTED'));
  }
  async deviceWire(id: string) {
    const current = await this.current(id);
    return current
      ? saved(current).wire_protocol
      : ((await this.ctx.storage.get<ConnectionError>(diagnosticKey(id)))?.desktop_wire_protocol ??
          null);
  }
  async cleanup() {
    for (const socket of this.ctx.getWebSockets()) {
      const info = saved(socket);
      if (!info.authenticated && info.expires_at <= Date.now())
        this.disconnect(socket, this.error(info, 'DEVICE_PROOF_EXPIRED'), 4005);
    }
  }
}
