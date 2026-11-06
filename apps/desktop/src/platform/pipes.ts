import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { BridgeError } from '@dotx/shared/errors';
import { discoverDesktop } from '../interfaces/host.ts';
import { WindowsPipe, ownerEndpoint } from './windows/pipes.ts';

export const coordinationEndpoint = (home: string) =>
  process.platform === 'win32' ? '\\\\.\\pipe\\codex-ipc' : path.join(home, 'ipc', 'ipc.sock');
export function connectDesktop(endpoint: string, coordination = false) {
  if (process.platform === 'win32') {
    const desktop = discoverDesktop();
    if (!desktop.image) throw new BridgeError('DESKTOP_PROCESS_PATH_MISSING');
    return new WindowsPipe(endpoint, desktop.image);
  }
  if (coordination) {
    const stat = fs.lstatSync(endpoint);
    if (!stat.isSocket() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
      throw new BridgeError('COORDINATION_SOCKET_IDENTITY_MISMATCH');
  }
  return net.createConnection(endpoint);
}
export const connectOwner = (dir: string) =>
  process.platform === 'win32'
    ? new WindowsPipe(ownerEndpoint(dir))
    : net.createConnection('owner.sock');
