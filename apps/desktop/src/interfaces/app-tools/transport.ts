import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import net from 'node:net';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { BridgeError, NativeError, errorCode } from '@dotx/shared/errors';
import type { Call } from '@dotx/shared/gateway';
import { FrameDecoder } from '../framing.ts';
const toolSchema = z
  .object({
    namespace: z.string(),
    name: z.string(),
    // The native interface owns JSON Schema dialects and argument validation.
    inputSchema: z.unknown().optional(),
  })
  .passthrough();
const rpcReply = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .passthrough()
    .optional(),
});
export interface NativeClient {
  call(tool: string, args: Call['params'], context?: { turnId: string }): Promise<unknown>;
}
type Rpc = typeof pipeRpc;
// PRIVATE CODEX API: the desktop-injected App Tools pipe uses length-prefixed JSON-RPC.
// Despite tools/list and tools/call names, its framing and envelopes are not public MCP.
// A desktop update can change either independently of the discovered tool schemas.
// Never discover another process's pipe or credentials.
export function pipeRpc(
  pipe: string | undefined,
  method: string,
  params: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (!pipe) return Promise.reject(new BridgeError('DESKTOP_PIPE_MISSING'));
  return new Promise((resolve, reject) => {
    const id = randomUUID(),
      socket = net.createConnection(pipe);
    const decoder = new FrameDecoder();
    let done = false;
    const finish = (error: unknown, result?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      decoder.reset();
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new BridgeError('DESKTOP_TIMEOUT', `No response to ${method}; reconcile, do not resend`),
        ),
      timeoutMs,
    );
    socket.once('connect', () => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk) => {
      if (done) return;
      // Decode the native reply here. Remote response limits belong to the relay.
      try {
        for (const frame of decoder.push(chunk)) {
          const reply = rpcReply.parse(JSON.parse(frame.toString('utf8')));
          if (reply.id !== id) throw new BridgeError('DESKTOP_RESPONSE_MISMATCH');
          if (reply.error) throw new NativeError(reply.error);
          finish(null, reply.result);
          return;
        }
      } catch (e) {
        finish(e);
      }
    });
    socket.once('error', (e) =>
      finish(
        new BridgeError(
          'DESKTOP_DISCONNECTED',
          `Desktop pipe error: ${errorCode(e) || 'unknown'}`,
          {
            cause: e,
          },
        ),
      ),
    );
    socket.once('close', () => finish(new BridgeError('DESKTOP_DISCONNECTED')));
  });
}

export class Native {
  readonly pipe: string | undefined;
  readonly callerThreadId: string;
  readonly rpc: Rpc;
  private discovery?: ReturnType<Native['discoverCapabilities']>;
  constructor({
    pipe,
    callerThreadId,
    rpc = pipeRpc,
  }: {
    pipe?: string;
    callerThreadId: string;
    rpc?: Rpc;
  }) {
    this.pipe = pipe;
    this.callerThreadId = callerThreadId;
    this.rpc = rpc;
  }
  capabilities() {
    // Cache successful discovery; a failed lookup can be retried by the next caller.
    return (this.discovery ??= this.discoverCapabilities().catch((error: unknown) => {
      this.discovery = undefined;
      throw error;
    }));
  }
  private async discoverCapabilities() {
    const parsed = z
      .object({ tools: z.array(toolSchema) })
      .safeParse(await this.rpc(this.pipe, 'tools/list', { threadStartKind: 'all' }));
    if (!parsed.success)
      throw new BridgeError('UNSUPPORTED_CAPABILITY_SCHEMA', undefined, { cause: parsed.error });
    const entries = parsed.data.tools;
    if (!entries.length) throw new BridgeError('NATIVE_METHOD_CATALOG_EMPTY');
    return { toolDefinitions: entries };
  }
  async rawCall(
    method: string,
    args: Call['params'],
    context?: { turnId: string },
  ): Promise<unknown> {
    const split = method.indexOf('.');
    if (split < 1 || split === method.length - 1)
      throw new BridgeError('INVALID_APP_TOOL_METHOD', 'Expected namespace.tool');
    const namespace = method.slice(0, split),
      tool = method.slice(split + 1);
    // Private caller envelope: threadId is our archived caller, not the target thread.
    // Target host/thread stay in arguments; changing this routing can execute in the wrong context.
    return this.rpc(this.pipe, 'tools/call', {
      arguments: args,
      callerSource: 'codex',
      callId: randomUUID(),
      hostId: 'local',
      namespace,
      threadId: this.callerThreadId,
      tool,
      // Tracked sends use the DO's pre-reserved ID. The desktop records it as
      // parent_turn_id on the target, outside the prompt. This is not native deduplication.
      turnId: context?.turnId ?? randomUUID(),
    });
  }
  async call(tool: string, args: Call['params'], context?: { turnId: string }): Promise<unknown> {
    let raw: unknown;
    try {
      raw = await this.rawCall(`codex_app.${tool}`, args, context);
    } catch (error) {
      this.discovery = undefined;
      throw error;
    }
    // Private App Tools result wrapper, used by health checks and exact-turn tracking.
    // Generic app_tools calls retain the raw result; this parser must be rechecked if it changes.
    const result = z
      .object({
        success: z.boolean(),
        contentItems: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
      })
      .safeParse(raw);
    if (!result.success) throw { code: 'UNSUPPORTED_TOOL_RESPONSE', response: raw };
    if (!result.data.success) throw new NativeError(raw);
    for (const item of result.data.contentItems || []) {
      if (typeof item.text === 'string') {
        try {
          return JSON.parse(item.text);
        } catch {}
      }
    }
    throw { code: 'UNSUPPORTED_TOOL_RESPONSE', response: raw };
  }
}
