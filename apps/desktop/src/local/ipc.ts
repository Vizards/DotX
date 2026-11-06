import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { connectOwner } from '../platform/pipes.ts';
import { verifyPrivate } from '../platform/windows/files.ts';
import { serveWindowsStatus } from '../platform/windows/pipes.ts';
// Both entry points fix cwd to PLUGIN_DATA before using IPC. Passing a relative
// address avoids the Unix socket path limit even when the data directory is long.
const endpoint = 'owner.sock';
function validateDirectory(dir: string) {
  if (process.platform === 'win32') {
    verifyPrivate(dir, true);
    return;
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
    throw new Error('OWNER_IPC_DIRECTORY_INVALID');
  if ((stat.mode & 0o777) !== 0o700) throw new Error('OWNER_IPC_PERMISSIONS_INVALID');
}
// The owner lock must be held before unlinking or listening on this path.
export async function serveStatus(dir: string, status: () => unknown) {
  validateDirectory(dir);
  if (process.platform === 'win32') return serveWindowsStatus(dir, status);
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
    server.listen(endpoint, () => {
      server.off('error', reject);
      resolve();
    });
  });
  fs.chmodSync(file, 0o600);
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
    const socket = connectOwner(dir);
    let body = '';
    const timer = setTimeout(
      () => socket.destroy(new Error('OWNER_STATUS_TIMEOUT')),
      DEFAULT_TIMEOUT_MS,
    );
    socket.once('close', () => clearTimeout(timer));
    socket.on('data', (chunk) => {
      body += chunk.toString();
      if (body.includes('\n')) {
        socket.destroy();
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('OWNER_STATUS_INVALID'));
        }
      }
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
