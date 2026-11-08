import { Duplex } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeError } from '@dotx/shared/errors';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import {
  checkedHandle,
  check,
  failure,
  INVALID_HANDLE,
  privateSecurity,
  processLease,
  userIdentity,
  win32,
} from './api.ts';
import type { Handle } from './api.ts';

// OVERLAPPED and data must remain at stable addresses until cancellation has
// completed. Windows signals the event once; pending I/O occupies neither a JS
// polling timer nor a Node worker thread.
function operation(
  handle: Handle,
  start: (memory: Handle, overlapped: Handle) => number,
  size = 0,
  input?: Buffer,
) {
  const api = win32(),
    ffi = api.ffi;
  const event = checkedHandle(api.createEvent(null, 1, 0, null), 'CreateEvent');
  const overlapped: Handle = ffi.alloc('uint8', 32),
    memory: Handle = ffi.alloc('uint8', Math.max(size, 1));
  ffi.encode(overlapped, 'uint8', Buffer.alloc(32), 32);
  ffi.encode(overlapped, 24, 'void *', event);
  if (input) ffi.encode(memory, 'uint8', input, input.length);
  let done = false,
    callback: ReturnType<typeof ffi.register> | undefined;
  const wait: (Handle | null)[] = [null];
  let resolve!: (value: Buffer) => void, reject!: (error: Error) => void;
  const promise = new Promise<Buffer>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const finish = (error?: Error, count = 0) => {
    if (done) return;
    done = true;
    const release = () => {
      if (callback) ffi.unregister(callback);
      const result = error ? undefined : Buffer.from(ffi.decode(memory, 'uint8', count));
      ffi.free(memory);
      ffi.free(overlapped);
      api.close(event);
      if (error) reject(error);
      else resolve(result!);
    };
    if (!wait[0]) {
      release();
      return;
    }
    // A Koffi callback runs on JS while the Windows callback thread waits for
    // it to return. Join that callback off-thread, then release its trampoline
    // and event. This brief cleanup wait starts only after I/O has completed.
    api.unregisterWait.async(wait[0], INVALID_HANDLE, (cleanupError: Error | null, ok: number) => {
      if (cleanupError || !ok) {
        // Do not free memory which an unjoined native callback could still use.
        reject(cleanupError ?? new BridgeError('PIPE_WAIT_CLEANUP_FAILED'));
        return;
      }
      release();
    });
  };
  const completed = () => {
    if (done) return;
    const count = [0];
    if (api.result(handle, overlapped, count, 0)) finish(undefined, count[0]);
    else finish(failure('Pipe I/O'));
  };
  try {
    callback = ffi.register(completed, api.waitCallback);
    // Register before starting I/O so registration failure leaves no pending
    // operation. INFINITE + WT_EXECUTEONLYONCE also covers immediate completion.
    check(api.registerWait(wait, event, callback, null, 0xffffffff, 8), 'Register pipe wait');
    if (start(memory, overlapped)) completed();
    else {
      const code = Number(api.lastError());
      if (code === 535 && size === 0) finish(); // Client connected before ConnectNamedPipe.
      else if (code !== 997) finish(failure('Pipe I/O', code));
    }
  } catch (error) {
    finish(error as Error);
  }
  return {
    promise,
    cancel: () => {
      if (!done) api.cancel(handle, overlapped);
    },
  };
}
type Operation = ReturnType<typeof operation>;

function peer(handle: Handle, server: boolean, desktopImage?: string) {
  const pid = [0],
    api = win32();
  check((server ? api.serverPid : api.clientPid)(handle, pid), 'GetNamedPipePeerProcessId');
  const lease = processLease(pid[0]);
  try {
    const identity = userIdentity();
    if (lease.sid !== identity.sid || lease.session !== identity.session || !lease.alive())
      throw new BridgeError('PIPE_PEER_IDENTITY_MISMATCH');
    if (desktopImage) {
      const canonical = (file: string) => fs.realpathSync.native(file).toLowerCase();
      if (canonical(lease.image) !== canonical(desktopImage))
        throw new BridgeError('DESKTOP_PIPE_PROCESS_MISMATCH');
    }
  } finally {
    lease.close();
  }
}
export class WindowsPipe extends Duplex {
  private handle?: Handle;
  private ownsHandle = true;
  private reading = false;
  private readonly pending = new Set<Operation>();
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });
  constructor(endpoint: string, desktopImage?: string, accepted?: Handle) {
    super({ allowHalfOpen: false });
    void this.ready.catch(() => {});
    // Let callers attach error/connect listeners before touching the OS.
    queueMicrotask(() => {
      if (this.destroyed) return;
      const since = Date.now();
      const connect = () => {
        try {
          if (!endpoint.startsWith('\\\\.\\pipe\\') || endpoint.slice(9).includes('\\'))
            throw new BridgeError('LOCAL_PIPE_REQUIRED');
          const api = win32();
          // OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION:
          // the peer may identify this client but cannot impersonate it.
          const handle: Handle =
            accepted ?? api.createFile(endpoint, 0xc0000000, 0, null, 3, 0x40110000, null);
          if (handle === INVALID_HANDLE || !handle) {
            const code = Number(api.lastError());
            if (code === 231 && Date.now() - since < DEFAULT_TIMEOUT_MS) {
              this.connectionTimer = setTimeout(connect, 25);
              return;
            }
            throw failure('Connect named pipe', code);
          }
          this.handle = handle;
          this.ownsHandle = !accepted;
          // Validate the handle used for all subsequent I/O, never a separate
          // probe connection that could name a different process by the time of use.
          peer(handle, !accepted, desktopImage);
          this.resolveReady();
          this.emit('connect');
        } catch (error) {
          this.destroy(error as Error);
        }
      };
      connect();
    });
  }
  private track(io: Operation) {
    this.pending.add(io);
    void io.promise.then(
      () => this.pending.delete(io),
      () => this.pending.delete(io),
    );
    return io.promise;
  }
  override _read() {
    if (this.reading || this.destroyed) return;
    this.reading = true;
    void this.ready
      .then(async () => {
        while (!this.destroyed) {
          const handle = this.handle!;
          const chunk = await this.track(
            operation(
              handle,
              (memory, overlap) => win32().read(handle, memory, 65536, null, overlap),
              65536,
            ),
          );
          if (this.destroyed) return;
          if (!chunk.length) {
            this.push(null);
            return;
          }
          if (!this.push(chunk)) {
            this.reading = false;
            return;
          }
        }
      })
      .catch((error: Error & { cause?: { win32?: number } }) => {
        if (this.destroyed) return;
        // Broken/closing pipe is EOF. Other errors remain actionable diagnostics.
        const code = error.cause?.win32;
        if (code === 109 || code === 232 || code === 233) this.push(null);
        else this.destroy(error);
      });
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    void this.ready
      .then(async () => {
        let offset = 0;
        while (offset < chunk.length) {
          if (this.destroyed) throw new BridgeError('PIPE_CLOSED');
          const handle = this.handle!,
            data = chunk.subarray(offset);
          const result = await this.track(
            operation(
              handle,
              (memory, overlap) => win32().write(handle, memory, data.length, null, overlap),
              data.length,
              data,
            ),
          );
          if (!result.length) throw new BridgeError('PIPE_WRITE_EMPTY');
          offset += result.length;
        }
      })
      .then(
        () => callback(),
        (error: Error) => callback(error),
      );
  }
  override _destroy(error: Error | null, callback: (error: Error | null) => void) {
    clearTimeout(this.connectionTimer);
    this.rejectReady(error ?? new BridgeError('PIPE_CLOSED'));
    for (const io of this.pending) io.cancel();
    // CancelIoEx requests cancellation; it does not complete it. Retain all
    // native memory and the HANDLE until every pending operation has settled.
    void Promise.allSettled([...this.pending].map((io) => io.promise)).then(() => {
      if (this.handle && this.ownsHandle) win32().close(this.handle);
      this.handle = undefined;
      callback(error);
    });
  }
}

export function ownerEndpoint(dir: string) {
  const identity = userIdentity();
  const key = [
    fs.realpathSync.native(path.resolve(dir)).toLowerCase(),
    identity.sid,
    identity.session,
  ];
  return `\\\\.\\pipe\\dotx-owner-${createHash('sha256').update(JSON.stringify(key)).digest('hex')}`;
}
export async function serveWindowsStatus(dir: string, status: () => unknown) {
  const api = win32(),
    security = privateSecurity(false),
    endpoint = ownerEndpoint(dir);
  let handle: Handle;
  try {
    // First-instance prevents another server from joining this installation's
    // pipe; ACL and PIPE_REJECT_REMOTE_CLIENTS restrict clients to this machine.
    handle = checkedHandle(
      api.createPipe(endpoint, 0x40080003, 8, 1, 65536, 65536, 0, security.attributes),
      'Create owner pipe',
    );
  } finally {
    security.close();
  }
  let stopped = false,
    accepting: Operation | undefined,
    socket: WindowsPipe | undefined;
  const run = (async () => {
    while (!stopped) {
      accepting = operation(handle, (_memory, overlap) => api.connectPipe(handle, overlap));
      try {
        await accepting.promise;
      } catch (error) {
        if (stopped) break;
        throw error;
      }
      accepting = undefined;
      if (stopped) break;
      socket = new WindowsPipe(endpoint, undefined, handle);
      const current = socket;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => current.destroy(), 5000);
        current.on('error', () => {});
        current.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        current.once('connect', () => {
          current.end(JSON.stringify(status()) + '\n');
          current.resume();
        });
      });
      socket = undefined;
      api.disconnectPipe(handle);
    }
  })();
  // Keep a failed listener visible; the owner must not silently serve stale state.
  void run.catch((error: unknown) =>
    process.stderr.write(
      JSON.stringify({ code: 'OWNER_IPC_FAILED', message: String(error) }) + '\n',
    ),
  );
  return async () => {
    stopped = true;
    accepting?.cancel();
    socket?.destroy();
    try {
      await run;
    } finally {
      api.close(handle);
    }
  };
}
