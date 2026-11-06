import fs from 'node:fs';
import { processLease } from './windows/api.ts';
import { closeDesktopProcess, desktopAlive } from './windows/pipes.ts';

export function parentLifetime(pipe: string | undefined) {
  const parent = process.ppid;
  if (process.platform === 'win32') {
    const lease = processLease(parent);
    return {
      // Windows ppid does not change when the parent exits. A process HANDLE
      // remains tied to the original process even after its PID is reused.
      alive: () => lease.alive() && desktopAlive(),
      close: () => {
        lease.close();
        closeDesktopProcess();
      },
    };
  }
  return {
    alive: () => process.ppid === parent && (!pipe || fs.existsSync(pipe)),
    close: () => {},
  };
}
