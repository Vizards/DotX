import type { Observations } from './observations.ts';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import type { DeviceOperation as Operation, Restore } from '@dotx/shared/state';
import WebSocket from 'ws';
import type { EventEmitter } from 'node:events';
import type { ConnectionCredentials } from '../runtime/config.ts';
import { gatewayCommand as commandSchema } from '@dotx/shared/gateway';
import type { Heartbeat, Diagnostic } from '@dotx/shared/protocol';
export interface RelaySocket extends Pick<EventEmitter, 'on'> {
  readyState: number;
  send(data: string): void;
  terminate(): void;
}
interface ConnectionOptions {
  credentials: () => ConnectionCredentials | null;
  deviceId: string;
  heartbeat: () => Heartbeat;
  execute: (operation: Operation, args: unknown) => Promise<unknown>;
  diagnostic?: (diagnostic: Diagnostic | null) => void;
  observations?: Pick<Observations, 'pending' | 'ack'>;
  restore?: (state: Restore, reconnect: boolean) => void;
  Socket?: new (url: string, options: WebSocket.ClientOptions) => RelaySocket;
}
import { BridgeError, safeError } from '@dotx/shared/errors';

// Transport recovery never retries commands. Durable state belongs to the DO; restore packets carry observation intents only.
export class DeviceConnection {
  readonly credentials: ConnectionOptions['credentials'];
  readonly deviceId: string;
  readonly heartbeat: ConnectionOptions['heartbeat'];
  readonly execute: ConnectionOptions['execute'];
  readonly diagnostic: NonNullable<ConnectionOptions['diagnostic']>;
  readonly Socket: NonNullable<ConnectionOptions['Socket']>;
  readonly observations: ConnectionOptions['observations'];
  readonly restore: ConnectionOptions['restore'];
  eventInterval: ReturnType<typeof setInterval> | undefined;
  delay: number;
  stopped: boolean;
  lastAck = 0;
  socket: RelaySocket | null = null;
  timer: ReturnType<typeof setTimeout> | undefined;
  interval: ReturnType<typeof setInterval> | undefined;
  constructor({
    credentials,
    deviceId,
    heartbeat,
    execute,
    diagnostic = () => {},
    Socket = WebSocket,
    observations,
    restore,
  }: ConnectionOptions) {
    this.credentials = credentials;
    this.deviceId = deviceId;
    this.heartbeat = heartbeat;
    this.execute = execute;
    this.diagnostic = diagnostic;
    this.Socket = Socket;
    this.observations = observations;
    this.restore = restore;
    this.delay = 1000;
    this.stopped = true;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.interval = setInterval(() => {
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastAck >= 45000) {
        this.diagnostic({ code: 'RELAY_HEARTBEAT_TIMEOUT' });
        socket.terminate();
      } else this.sendHeartbeat();
    }, 15000);
    this.eventInterval = setInterval(() => this.sendEvents(), 2000);
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
    this.delay = Math.min(30000, this.delay * 2);
  }
  connect() {
    if (this.stopped) return;
    let socket;
    try {
      const credentials = this.credentials();
      if (!credentials) throw new BridgeError('RELAY_NOT_CONFIGURED');
      const url = new URL('/device/connect', credentials.relayUrl);
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      )
        throw new BridgeError('HTTPS_REQUIRED');
      if (!credentials.deviceToken) throw new BridgeError('DEVICE_TOKEN_MISSING');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = this.socket = new this.Socket(url.toString(), {
        headers: {
          Authorization: `Bearer ${credentials.deviceToken}`,
          'X-Device-Id': this.deviceId,
        },
        handshakeTimeout: 10000,
        maxPayload: 2 * 1024 * 1024,
      });
    } catch (error) {
      this.diagnostic(safeError(error));
      this.retry();
      return;
    }
    socket.on('open', () => {
      this.delay = 1000;
      this.lastAck = Date.now();
      this.diagnostic(null);
      this.sendHeartbeat();
      this.sendEvents();
    });
    let firstRestore = true;
    socket.on('message', async (bytes: unknown) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(bytes));
      } catch {
        return;
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        raw.type === 'heartbeat_ack' &&
        'protocol' in raw &&
        raw.protocol === WIRE_VERSION
      ) {
        this.lastAck = Date.now();
        return;
      }
      const control = raw as any;
      if (control?.type === 'restore' && control.protocol === WIRE_VERSION) {
        this.restore?.(control, firstRestore);
        firstRestore = false;
        return;
      }
      if (control?.type === 'observations_ack' && Array.isArray(control.ids)) {
        this.observations?.ack(control.ids);
        this.sendEvents();
        return;
      }
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      let response;
      try {
        response = { ok: true, result: await this.execute(msg.operation, msg.args) };
      } catch (error) {
        response = { ok: false, error: safeError(error) };
      }
      // Only the original connection may return this command's response.
      if (socket.readyState === WebSocket.OPEN) {
        try {
          const body = JSON.stringify({ type: 'response', id: msg.id, ...response });
          socket.send(
            Buffer.byteLength(body) <= 4 * 1024 * 1024
              ? body
              : JSON.stringify({
                  type: 'response',
                  id: msg.id,
                  ok: false,
                  error: {
                    code: 'RESULT_TOO_LARGE',
                    message:
                      'RPC completed but its response exceeds the transport limit. Ordinary RPC payloads are not retained. Reduce future query limits; do not repeat a write to recover its result.',
                  },
                }),
          );
        } catch {
          socket.terminate();
        }
      }
    });
    socket.on('error', () => this.diagnostic({ code: 'RELAY_CONNECTION_FAILED' }));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.retry();
    });
  }
  sendHeartbeat() {
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(
          JSON.stringify({ ...this.heartbeat(), type: 'heartbeat', protocol: WIRE_VERSION }),
        );
      } catch {
        socket.terminate();
      }
    }
  }
  sendEvents() {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN || !this.observations) return;
    const events = this.observations.pending();
    if (!events.length) return;
    try {
      socket.send(
        JSON.stringify({ type: 'observations', protocol: WIRE_VERSION, observations: events }),
      );
    } catch {
      socket.terminate();
    }
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    clearInterval(this.eventInterval);
    this.timer = undefined;
    this.socket?.terminate();
    this.socket = null;
  }
}
