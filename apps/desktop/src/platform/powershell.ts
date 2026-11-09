import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BridgeError } from '@dotx/shared/errors';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';

export function runPowerShell(args: string[], action: string, timeout = DEFAULT_TIMEOUT_MS) {
  try {
    return execFileSync(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { timeout, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stderr?: string;
      status?: number | null;
      signal?: string | null;
    };
    throw new BridgeError(
      'WINDOWS_POWERSHELL_FAILED',
      `${action}: ${failure.stderr?.trim() || failure.message}\n` +
        "Check Windows PowerShell availability, access to the target path, and your device's script/application-control policy.",
      { cause: { code: failure.code, exitCode: failure.status, signal: failure.signal } },
    );
  }
}
