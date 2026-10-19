import { BridgeError, NativeError } from '@dotx/shared/errors';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
import { z } from 'zod';
import packageInfo from '../../package.json' with { type: 'json' };

const bootstrapReply = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
export class AppServer {
  readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly process: ChildProcessByStdio<Writable, Readable, null>;
  readonly reader: readline.Interface;
  constructor(cli: string, home: string, cwd: string) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('CODEX_')),
    );
    env.CODEX_HOME = home;
    this.process = spawn(cli, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    }) as ChildProcessByStdio<Writable, Readable, null>;
    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on('line', (line) => {
      let msg;
      try {
        msg = bootstrapReply.parse(JSON.parse(line));
      } catch (cause) {
        this.fail(new BridgeError('BOOTSTRAP_INVALID_MESSAGE', undefined, { cause }));
        this.close();
        return;
      }
      if (msg.method && msg.id !== undefined) {
        this.write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'Installer never approves actions or runs model tools' },
        });
        return;
      }
      if (typeof msg.id !== 'string') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error !== undefined) p.reject(new NativeError(msg.error));
      else p.resolve(msg.result);
    });
    this.process.on('error', (cause) =>
      this.fail(new BridgeError('BOOTSTRAP_START_FAILED', undefined, { cause })),
    );
    this.process.on('exit', (exitCode, signal) =>
      this.fail(new BridgeError('BOOTSTRAP_EXITED', undefined, { cause: { exitCode, signal } })),
    );
    this.process.stdin.on('error', (cause) =>
      this.fail(new BridgeError('BOOTSTRAP_PIPE_FAILED', undefined, { cause })),
    );
  }
  private fail(error: unknown) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  write(msg: unknown) {
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }
  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('BOOTSTRAP_TIMEOUT', method));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async initialize() {
    await this.call('initialize', {
      clientInfo: { name: 'dotx-setup', version: packageInfo.version },
    });
    this.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
  }
  close() {
    const p = this.process;
    if (p.exitCode !== null || p.signalCode !== null) return;
    p.stdin.end();
    const t = setTimeout(() => p.kill('SIGTERM'), DEFAULT_TIMEOUT_MS);
    t.unref();
    p.once('exit', () => clearTimeout(t));
  }
}
