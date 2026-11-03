import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
// Both entry points fix cwd to PLUGIN_DATA before using IPC. Passing a relative
// address avoids the Unix socket path limit even when the data directory is long.
const endpoint = 'owner.sock';
// Windows uses a named pipe as the owner address instead of a socket file:
// the desktop host's plugin sandbox denies binding a Unix-domain socket in
// the data directory (listen EACCES), while named pipes are the native IPC
// namespace and depend on neither cwd nor path length. The pipe name is
// derived from the data directory so separate installations never collide.
// Windows also has no POSIX uid/mode to check; the data directory is guarded
// by its ACL instead.
function ownerAddress(dir: string) {
  if (process.platform !== 'win32') return endpoint;
  const key = createHash('sha256')
    .update(path.resolve(dir).toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `\\\\.\\pipe\\dotx-owner-${key}`;
}
function validateDirectory(dir: string) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('OWNER_IPC_DIRECTORY_INVALID');
  if (process.platform === 'win32') return;
  if (stat.uid !== process.getuid?.()) throw new Error('OWNER_IPC_DIRECTORY_INVALID');
  if ((stat.mode & 0o777) !== 0o700) throw new Error('OWNER_IPC_PERMISSIONS_INVALID');
}
// The owner lock must be held before unlinking or listening on this path.
export async function serveStatus(dir: string, status: () => unknown) {
  validateDirectory(dir);
  const file = path.join(dir, endpoint);
  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.end(JSON.stringify(status()) + '\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(ownerAddress(dir), () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return () =>
    new Promise<void>((resolve) =>
      server.close(() => {
        if (process.platform !== 'win32') {
          try {
            fs.unlinkSync(file);
          } catch {}
        }
        resolve();
      }),
    );
}
export async function readOwner(dir: string): Promise<unknown> {
  validateDirectory(dir);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ownerAddress(dir));
    let body = '';
    socket.setTimeout(DEFAULT_TIMEOUT_MS, () => socket.destroy(new Error('OWNER_STATUS_TIMEOUT')));
    socket.on('data', (chunk) => {
      body += chunk.toString();
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('OWNER_STATUS_INVALID'));
      }
    });
  });
}
