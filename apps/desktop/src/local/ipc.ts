import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
// Both entry points fix cwd to PLUGIN_DATA before using IPC. Passing a relative
// address avoids the Unix socket path limit even when the data directory is long.
const endpoint = 'owner.sock';
// POSIX callers listen on the bare endpoint with cwd fixed to the data
// directory, which keeps the address under the Unix socket path limit.
// Windows named the same file through an absolute path; its Unix-domain
// sockets are filesystem entries, and POSIX uid/mode checks do not apply —
// the directory is guarded by its ACL instead.
const endpointPath = (dir: string) =>
  process.platform === 'win32' ? path.join(dir, endpoint) : endpoint;
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
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.end(JSON.stringify(status()) + '\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpointPath(dir), () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return () =>
    new Promise<void>((resolve) =>
      server.close(() => {
        try {
          fs.unlinkSync(file);
        } catch {}
        resolve();
      }),
    );
}
export async function readOwner(dir: string): Promise<unknown> {
  validateDirectory(dir);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpointPath(dir));
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
