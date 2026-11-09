import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateDir } from './files.ts';
// libuv's public Windows-only UV_FS_O_EXLOCK is not exported by fs.constants.
// https://github.com/libuv/libuv/blob/v1.52.1/src/win/fs.c#L460
const UV_FS_O_EXLOCK = 0x10000000;
function openWindowsLock(file: string) {
  try {
    return fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | UV_FS_O_EXLOCK, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EBUSY') return null;
    throw error;
  }
}
export function tryLock(dir: string, name: 'connector.lock' | 'installation.lock') {
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    throw new Error('UNSUPPORTED_PLATFORM');
  privateDir(dir);
  const fd =
    process.platform === 'win32'
      ? openWindowsLock(path.join(dir, name))
      : fs.openSync(path.join(dir, name), 'a+', 0o600);
  if (fd === null) return null;
  try {
    if (process.platform === 'darwin')
      execFileSync('/usr/bin/lockf', ['-s', '-t', '0', '3'], {
        stdio: ['ignore', 'ignore', 'pipe', fd],
        timeout: 30_000,
      });
    let released = false;
    return () => {
      if (!released) {
        released = true;
        fs.closeSync(fd);
      }
    };
  } catch (error) {
    fs.closeSync(fd);
    if ((error as { status?: number }).status === 75) return null;
    throw error;
  }
}
