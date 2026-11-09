import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeError } from '@dotx/shared/errors';

export const coordinationEndpoint = (home: string) =>
  process.platform === 'win32' ? '\\\\.\\pipe\\codex-ipc' : path.join(home, 'ipc', 'ipc.sock');
export function connectDesktop(endpoint: string, coordination = false) {
  if (coordination && process.platform !== 'win32') {
    const stat = fs.lstatSync(endpoint);
    if (!stat.isSocket() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
      throw new BridgeError('COORDINATION_SOCKET_IDENTITY_MISMATCH');
  }
  return net.createConnection(endpoint);
}
// Entry points set cwd to PLUGIN_DATA. A relative Unix socket avoids its path limit;
// Windows names follow the same real directory as the installation and owner locks.
export const ownerEndpoint = (dir: string) =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\dotx-owner-${createHash('sha256')
        .update(fs.realpathSync.native(path.resolve(dir)).toLowerCase())
        .digest('hex')}`
    : 'owner.sock';
export const connectOwner = (dir: string) => net.createConnection(ownerEndpoint(dir));
