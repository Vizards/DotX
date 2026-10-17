import net from 'node:net';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BridgeError } from '@dotx/shared/errors';

export type WireMessage = Record<string, any>;
/**
 * PRIVATE CODEX PROTOCOL: desktop broker framing, client discovery and owner routing.
 * This is neither public App Server JSON-RPC nor MCP. Desktop updates can change it;
 * a successful initialize alone does not validate follow, settings or approval messages.
 */
export class CoordinationWire {
  readonly options: {
    endpoint: string;
    timeoutMs?: number;
    onMessage: (message: WireMessage) => void;
    onDisconnect: () => void;
  };
  socket?: net.Socket;
  clientId?: string;
  connecting?: Promise<void>;
  buffer = Buffer.alloc(0);
  readonly pending = new Map<
    string,
    {
      method: string;
      owner?: string;
      resolve: (value: WireMessage) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(options: CoordinationWire['options']) {
    this.options = options;
  }
  async connect() {
    if (this.clientId) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async open() {
    const st = fs.lstatSync(this.options.endpoint);
    if (!st.isSocket() || st.uid !== process.getuid?.() || st.mode & 0o077)
      throw new BridgeError('COORDINATION_SOCKET_IDENTITY_MISMATCH');
    this.buffer = Buffer.alloc(0);
    const socket = net.createConnection(this.options.endpoint);
    this.socket = socket;
    socket.on('data', (chunk) => {
      if (this.socket === socket) this.receive(chunk);
    });
    socket.on('error', () => this.disconnected(socket));
    socket.on('close', () => this.disconnected(socket));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new BridgeError('COORDINATION_CONNECT_TIMEOUT'));
      }, this.options.timeoutMs ?? 12000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', () => {
        clearTimeout(timer);
        reject(new BridgeError('COORDINATION_CONNECT_FAILED'));
      });
    });
    try {
      const reply = await this.request('initialize', { clientType: 'dotx' }, 0);
      if (reply.resultType !== 'success' || typeof reply.result?.clientId !== 'string')
        throw new BridgeError('COORDINATION_INITIALIZE_FAILED');
      this.clientId = reply.result.clientId;
    } catch (error) {
      socket.destroy();
      this.disconnected(socket);
      throw error;
    }
  }
  disconnected(socket: net.Socket) {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.clientId = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('COORDINATION_DISCONNECTED'));
    }
    this.pending.clear();
    this.options.onDisconnect();
  }
  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE();
      if (length > 32 * 1024 * 1024) {
        this.close();
        return;
      }
      if (this.buffer.length < length + 4) return;
      let message: WireMessage;
      try {
        message = JSON.parse(this.buffer.subarray(4, length + 4).toString());
      } catch {
        this.close();
        return;
      }
      this.buffer = this.buffer.subarray(length + 4);
      if (message.type === 'response') {
        const p = this.pending.get(message.requestId);
        if (!p) continue;
        this.pending.delete(message.requestId);
        clearTimeout(p.timer);
        // Broker failures (for example no-client-found after desktop restart)
        // contain only requestId/resultType/error. Successful owner responses
        // must still identify both the method and the selected owner.
        const brokerError =
          message.resultType === 'error' &&
          typeof message.error === 'string' &&
          message.method === undefined;
        if (
          (!brokerError && message.method !== p.method) ||
          (message.resultType === 'success' && p.owner && message.handledByClientId !== p.owner)
        )
          p.reject(new BridgeError('COORDINATION_RESPONSE_SOURCE_MISMATCH'));
        else p.resolve(message);
      } else if (message.type === 'client-discovery-request') {
        this.write({
          type: 'client-discovery-response',
          requestId: message.requestId,
          response: { canHandle: false },
        });
      } else {
        try {
          this.options.onMessage(message);
        } catch {
          this.close();
        }
      }
    }
  }
  write(message: WireMessage) {
    if (!this.socket || this.socket.destroyed) throw new BridgeError('COORDINATION_DISCONNECTED');
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    this.socket.write(Buffer.concat([header, body]));
  }
  request(
    method: string,
    params: WireMessage,
    version: number,
    owner?: string,
    hostId?: string,
    requestId: string = randomUUID(),
  ): Promise<WireMessage> {
    // version belongs to this native message method, not the desktop release or MCP protocol.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          reject(
            new BridgeError(
              'COORDINATION_TIMEOUT',
              `No response to ${method}; reconcile, do not resend`,
            ),
          );
        },
        (this.options.timeoutMs ?? 12000) + 1000,
      );
      this.pending.set(requestId, { method, owner, resolve, reject, timer });
      try {
        this.write({
          type: 'request',
          requestId,
          sourceClientId: this.clientId ?? 'initializing',
          method,
          params,
          version,
          targetClientId: owner,
          timeoutMs: this.options.timeoutMs ?? 12000,
          ...(hostId && hostId !== 'local' ? { hostId } : {}),
        });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(e);
      }
    });
  }
  follow(hostId: string, conversationId: string, owner: string, following: boolean) {
    this.write({
      type: 'broadcast',
      method: 'thread-stream-following-changed',
      version: 1,
      sourceClientId: this.clientId,
      targetClientIds: [owner],
      params: { hostId, conversationId, following },
    });
  }
  close() {
    this.socket?.destroy();
  }
}

/**
 * Private desktop state uses Immer array-path patches, not JSON Pointer strings.
 * Patch semantics are not covered by the public App Server schema. A revision gap or
 * unsupported patch must trigger a new snapshot, never a guessed approval/turn state.
 */
export function applyStatePatches(state: WireMessage, patches: WireMessage[]) {
  let next = structuredClone(state);
  for (const patch of patches) {
    const parts: (string | number)[] = patch.path;
    if (
      !Array.isArray(parts) ||
      parts.some((p) => ['__proto__', 'constructor', 'prototype'].includes(String(p)))
    )
      throw new BridgeError('COORDINATION_INVALID_PATCH');
    if (!parts.length) {
      if (patch.op !== 'replace') throw new BridgeError('COORDINATION_INVALID_PATCH');
      next = structuredClone(patch.value);
      continue;
    }
    let target: any = next;
    for (const p of parts.slice(0, -1)) {
      if (!target || !Object.hasOwn(target, p)) throw new BridgeError('COORDINATION_INVALID_PATCH');
      target = target[p];
    }
    const key = parts.at(-1)!;
    if (patch.op === 'remove') {
      if (Array.isArray(target)) target.splice(Number(key), 1);
      else delete target[key];
    } else if (patch.op === 'add' || patch.op === 'replace') {
      if (Array.isArray(target) && patch.op === 'add')
        target.splice(Number(key), 0, structuredClone(patch.value));
      else target[key] = structuredClone(patch.value);
    } else throw new BridgeError('COORDINATION_INVALID_PATCH');
  }
  return next;
}
