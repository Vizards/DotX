import { BridgeError } from '@dotx/shared/errors';
import fs from 'node:fs';
import path from 'node:path';
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
  error: z.object({ message: z.string() }).optional(),
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
    const log = fs.openSync(path.join(cwd, 'bootstrap.log'), 'a', 0o600);
    this.process = spawn(cli, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', log],
    }) as ChildProcessByStdio<Writable, Readable, null>;
    fs.closeSync(log); // Diagnostic logs stay machine-local; never emit config/auth logs.
    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on('line', (line) => {
      let msg;
      try {
        msg = bootstrapReply.parse(JSON.parse(line));
      } catch {
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
      if (msg.error) p.reject(new BridgeError('BOOTSTRAP_RPC_ERROR', msg.error.message));
      else p.resolve(msg.result);
    });
    const fail = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new BridgeError('BOOTSTRAP_EXITED'));
      }
      this.pending.clear();
    };
    this.process.on('error', fail);
    this.process.on('exit', fail);
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
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  async initialize() {
    await this.call('initialize', {
      clientInfo: { name: 'dotx-setup', version: packageInfo.version },
    });
    this.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
  }
  close() {
    this.process.stdin.end();
    const p = this.process;
    const t = setTimeout(() => p.kill('SIGTERM'), 3000);
    t.unref();
  }
}
