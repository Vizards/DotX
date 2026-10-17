import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function tryConnectorLock(dir: string): boolean {
  // All versions of one installation share this inode. Never unlink the lock file.
  const fd = fs.openSync(path.join(dir, 'connector.lock'), 'a+', 0o600);
  try {
    // macOS lockf's descriptor mode locks the inherited open file description.
    // The helper exits immediately; this process keeps the descriptor until exit.
    // Do not release it while adapters or the cloud connection may still be alive.
    execFileSync('/usr/bin/lockf', ['-s', '-t', '0', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', fd],
    });
    return true;
  } catch (error) {
    fs.closeSync(fd);
    if ((error as { status?: number }).status === 75) return false; // EX_TEMPFAIL: occupied
    throw error;
  }
}
