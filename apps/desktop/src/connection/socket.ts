import WebSocket from 'ws';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { authResultSchema, connectionErrorSchema } from '@dotx/shared/wire/authentication';
import type { DeviceHello, DeviceChallenge } from '@dotx/shared/wire/authentication';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { gatewayCommand } from '@dotx/shared/wire/commands';
import type { DeviceOperation } from '@dotx/shared/requests';
import type { Heartbeat, Diagnostic } from '@dotx/shared/devices';
import { errorValue } from '@dotx/shared/errors';
import type { ReadyConfig } from '../local/config.ts';
import type { Identity } from '../local/identity.ts';
import type { Observations } from './observations.ts';
import { prove } from './proof.ts';
import packageInfo from '../../package.json' with { type: 'json' };
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
interface Options {
  config: ReadyConfig;
  identity: Identity;
  generation: number;
  heartbeat: () => Heartbeat;
  execute: (operation: DeviceOperation, args: unknown) => Promise<unknown>;
  observations: Pick<Observations, 'pending' | 'ack'>;
  diagnostic: (error: Diagnostic | null) => void;
}
export class DeviceConnection {
  readonly options: Options;
  socket: WebSocket | null = null;
  stopped = true;
  attempt = 0;
  delay = 1000;
  lastAck = 0;
  authenticated = false;
  approved = false;
  challenge: DeviceChallenge | null = null;
  state: 'offline' | 'connecting' | 'authenticating' | 'pending' | 'approved' | 'stopped' =
    'offline';
  timer: ReturnType<typeof setTimeout> | undefined;
  handshake: ReturnType<typeof setTimeout> | undefined;
  heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  eventsTimer: ReturnType<typeof setInterval> | undefined;
  constructor(options: Options) {
    this.options = options;
  }
  status() {
    return {
      state: this.state,
      authenticated: this.authenticated,
      approved: this.approved,
      generation: this.options.generation,
      attempt: this.attempt,
      server_version: this.challenge?.server_version ?? null,
      server_wire_protocol: this.challenge?.server_wire_protocol ?? null,
    };
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.heartbeatTimer = setInterval(() => {
      if (!this.authenticated) return;
      if (Date.now() - this.lastAck >= 45_000) {
        this.options.diagnostic({ code: 'RELAY_HEARTBEAT_TIMEOUT' });
        this.socket?.terminate();
      } else this.sendHeartbeat();
    }, 15_000);
    this.eventsTimer = setInterval(() => this.sendEvents(), 2000);
    this.connect();
  }
  retry() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.connect();
      },
      this.delay + Math.random() * 500,
    );
    this.delay = Math.min(30_000, this.delay * 2);
  }
  connect() {
    if (this.stopped) return;
    const { config, identity, generation } = this.options;
    const hello: DeviceHello = {
      device_id: config.deviceId,
      key_id: identity.keyId,
      generation,
      attempt: ++this.attempt,
      desktop_version: packageInfo.version,
      wire_protocol: WIRE_VERSION,
    };
    const url = new URL('/device/connect', config.service.origin);
    url.protocol = 'wss:';
    for (const [key, value] of Object.entries(hello)) url.searchParams.set(key, String(value));
    this.state = 'connecting';
    this.authenticated = false;
    this.approved = false;
    this.challenge = null;
    const socket = (this.socket = new WebSocket(url, {
      handshakeTimeout: DEFAULT_TIMEOUT_MS,
      maxPayload: MAX_MESSAGE_BYTES,
    }));
    this.handshake = setTimeout(() => {
      if (this.socket === socket && !this.authenticated) {
        this.options.diagnostic({ code: 'DEVICE_AUTH_TIMEOUT' });
        socket.terminate();
      }
    }, DEFAULT_TIMEOUT_MS);
    socket.on('open', () => {
      if (this.socket === socket) this.state = 'authenticating';
    });
    socket.on('unexpected-response', (_request, response) => {
      if (this.socket !== socket) return;
      this.options.diagnostic({ code: 'DEVICE_CONNECTION_REJECTED', status: response.statusCode });
      if ([400, 401, 403].includes(response.statusCode ?? 0)) this.stop();
      else socket.terminate();
    });
    socket.on('message', async (bytes) => {
      if (this.socket !== socket || this.stopped) return;
      let raw: any;
      try {
        raw = JSON.parse(String(bytes));
      } catch {
        this.options.diagnostic({ code: 'INVALID_RELAY_MESSAGE' });
        this.stop();
        return;
      }
      if (raw?.type === 'challenge') {
        if (this.challenge || this.authenticated || typeof raw.challenge !== 'string') {
          this.options.diagnostic({ code: 'INVALID_DEVICE_CHALLENGE' });
          this.stop();
          return;
        }
        try {
          const proof = prove(raw.challenge, hello, config, identity);
          this.challenge = proof.challenge;
          socket.send(JSON.stringify({ type: 'proof', proof: proof.proof }));
        } catch (error) {
          this.options.diagnostic(errorValue(error));
          this.stop();
        }
        return;
      }
      const error = connectionErrorSchema.safeParse(raw);
      if (error.success) {
        this.options.diagnostic(error.data);
        if (error.data.code === 'DEVICE_PROTOCOL_MISMATCH') {
          socket.terminate();
        } else this.stop();
        return;
      }
      const result = authResultSchema.safeParse(raw);
      if (result.success) {
        const value = result.data;
        if (
          !this.challenge ||
          value.socket_id !== this.challenge.socket_id ||
          value.server_wire_protocol !== WIRE_VERSION ||
          value.server_wire_protocol !== this.challenge.server_wire_protocol
        ) {
          this.options.diagnostic({ code: 'DEVICE_AUTH_RESULT_MISMATCH' });
          this.stop();
          return;
        }
        clearTimeout(this.handshake);
        this.delay = 1000;
        this.authenticated = true;
        this.approved = value.status === 'approved';
        this.state = value.status;
        this.lastAck = Date.now();
        this.options.diagnostic(null);
        this.sendHeartbeat();
        this.sendEvents();
        return;
      }
      if (!this.authenticated) return;
      if (raw?.type === 'heartbeat_ack') {
        if (raw.protocol !== WIRE_VERSION) {
          this.options.diagnostic({ code: 'DEVICE_PROTOCOL_MISMATCH' });
          socket.terminate();
        } else this.lastAck = Date.now();
        return;
      }
      if (!this.approved) return;
      if (
        raw?.type === 'observations_ack' &&
        Array.isArray(raw.ids) &&
        raw.ids.every((id: unknown) => typeof id === 'string')
      ) {
        this.options.observations.ack(raw.ids);
        this.sendEvents();
        return;
      }
      const command = gatewayCommand.safeParse(raw);
      if (!command.success) {
        this.options.diagnostic({ code: 'INVALID_RELAY_COMMAND' });
        socket.terminate();
        return;
      }
      const message = command.data;
      let response;
      try {
        response = {
          ok: true,
          result: await this.options.execute(message.operation, message.args),
        };
      } catch (error) {
        response = { ok: false, error: errorValue(error) };
      }
      if (
        this.socket !== socket ||
        this.stopped ||
        !this.approved ||
        socket.readyState !== WebSocket.OPEN
      )
        return;
      try {
        const body = JSON.stringify({ type: 'response', id: message.id, ...response }),
          size = Buffer.byteLength(body);
        socket.send(
          size <= MAX_MESSAGE_BYTES
            ? body
            : JSON.stringify({
                type: 'response',
                id: message.id,
                ok: false,
                error: {
                  code: 'RESULT_TOO_LARGE',
                  message:
                    'RPC completed but its response exceeds the 32 MiB transport limit. The payload is not retained. Do not repeat a write to recover its result.',
                  size_bytes: size,
                  limit_bytes: MAX_MESSAGE_BYTES,
                },
              }),
        );
      } catch (error) {
        this.options.diagnostic({ code: 'RELAY_RESPONSE_FAILED', cause: errorValue(error) });
        socket.terminate();
      }
    });
    socket.on('error', (error) => {
      if (this.socket === socket && !this.stopped)
        this.options.diagnostic({ code: 'RELAY_CONNECTION_FAILED', cause: errorValue(error) });
    });
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      clearTimeout(this.handshake);
      this.socket = null;
      this.authenticated = false;
      this.approved = false;
      if ([4001, 4002, 4003, 4005].includes(code)) {
        this.stop();
        return;
      }
      if (!this.stopped) {
        this.state = 'offline';
        this.retry();
      }
    });
  }
  sendHeartbeat() {
    const socket = this.socket;
    if (!this.authenticated || socket?.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(
        JSON.stringify({ ...this.options.heartbeat(), type: 'heartbeat', protocol: WIRE_VERSION }),
      );
    } catch {
      socket.terminate();
    }
  }
  sendEvents() {
    const socket = this.socket;
    if (!this.approved || socket?.readyState !== WebSocket.OPEN) return;
    const observations = this.options.observations.pending();
    if (!observations.length) return;
    try {
      socket.send(JSON.stringify({ type: 'observations', protocol: WIRE_VERSION, observations }));
    } catch {
      socket.terminate();
    }
  }
  stop() {
    this.stopped = true;
    this.state = 'stopped';
    this.authenticated = false;
    this.approved = false;
    clearTimeout(this.timer);
    clearTimeout(this.handshake);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.eventsTimer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
  }
}
