import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { connectOwner, ownerEndpoint } from '../platform/pipes.ts';
function validateDirectory(dir: string) {
  if (process.platform === 'win32') return;
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
    throw new Error('OWNER_IPC_DIRECTORY_INVALID');
  if ((stat.mode & 0o777) !== 0o700) throw new Error('OWNER_IPC_PERMISSIONS_INVALID');
}
// The owner lock must be held before unlinking or listening on this endpoint.
// Windows uses Node's default pipe permissions: status is readable metadata only.
export async function serveStatus(dir: string, status: () => unknown) {
  validateDirectory(dir);
  const endpoint = ownerEndpoint(dir);
  const file = process.platform === 'win32' ? undefined : path.join(dir, endpoint);
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
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
  if (file) fs.chmodSync(file, 0o600);
  return () => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) =>
      server.close(() => {
        if (file) {
          try {
            fs.unlinkSync(file);
          } catch {}
        }
        resolve();
      }),
    );
  };
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
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      body += chunk;
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
