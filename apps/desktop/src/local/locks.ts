import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateDir } from './files.ts';

function lockDarwin(dir: string, name: string) {
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

// Windows has no lockf/flock. The lock is the file itself, created exclusively
// and stamped with the owner's pid. A file whose pid is gone is stale and may
// be reclaimed once; an unreadable pid is treated as held, never as free.
function lockWindows(dir: string, name: string) {
  privateDir(dir);
  const file = path.join(dir, name);
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try {
      fd = fs.openSync(file, 'wx+', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let alive = true;
      try {
        const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch {
            alive = false;
          }
        }
      } catch {}
      if (alive || attempt === 1) return null;
      try {
        fs.unlinkSync(file);
      } catch {}
      continue;
    }
    fs.writeFileSync(fd, String(process.pid));
    let released = false;
    return () => {
      if (!released) {
        released = true;
        fs.closeSync(fd);
        try {
          fs.unlinkSync(file);
        } catch {}
      }
    };
  }
  return null;
}

export function tryLock(dir: string, name: 'connector.lock' | 'installation.lock') {
  if (process.platform === 'darwin') return lockDarwin(dir, name);
  if (process.platform === 'win32') return lockWindows(dir, name);
  throw new Error('MACOS_REQUIRED');
}
