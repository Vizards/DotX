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
    const options = { encoding: 'utf8' as const, timeout: 15000, maxBuffer: 32 * 1024 * 1024 };
    execFileSync(
      cli,
      ['app-server', 'generate-json-schema', '--experimental', '--out', directory],
      options,
    );
    return loadCatalog(directory);
  } catch {
    throw new BridgeError('APP_SERVER_SCHEMA_GENERATION_FAILED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
