import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateDir } from './files.ts';
export function tryLock(dir: string, name: 'connector.lock' | 'installation.lock') {
  if (process.platform !== 'darwin') throw new Error('MACOS_REQUIRED');
  privateDir(dir);
  const fd = fs.openSync(path.join(dir, name), 'a+', 0o600);
  try {
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
