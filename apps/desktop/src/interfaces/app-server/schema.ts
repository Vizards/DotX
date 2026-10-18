import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BridgeError } from '@dotx/shared/errors';
import { loadCatalog } from './catalog.ts';

// Ask the executable that will run the RPCs for its current schema. Each instance
// uses its own temporary directory; no version whitelist or shared stale cache.
export function readNativeCatalog(cli: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotx-schema-'));
  try {
    execFileSync(
      cli,
      ['app-server', 'generate-json-schema', '--experimental', '--out', directory],
      // The schema is written to files; command output is not consumed.
      { timeout: DEFAULT_TIMEOUT_MS, stdio: 'ignore' },
    );
    return loadCatalog(directory);
  } catch {
    throw new BridgeError('APP_SERVER_SCHEMA_GENERATION_FAILED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
