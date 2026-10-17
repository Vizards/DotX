import fs from 'node:fs';
import path from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDeviceMcp } from './mcp/server.ts';
import { stateDir } from './runtime/state.ts';
import { startDevice } from './runtime/runtime.ts';
import { tryConnectorLock } from './runtime/connector-lock.ts';
import { safeError } from '@dotx/shared/errors';

process.umask(0o077);
const dir = stateDir(),
  parent = process.ppid,
  pipe = process.env.CODEX_APP_TOOLS_PIPE_PATH;
let runtime: ReturnType<typeof startDevice> | undefined;
let diagnostic = 'SETUP_REQUIRED';
const stdio = serveStdio(
  () =>
    createDeviceMcp(
      () =>
        runtime?.status() ?? {
          availability: diagnostic === 'CONNECTOR_ACTIVE_ELSEWHERE' ? 'standby' : 'unavailable',
          diagnostic: { code: diagnostic },
          setup:
            diagnostic === 'CONNECTOR_ACTIVE_ELSEWHERE'
              ? 'Another DotX process owns this installation. Check its health through Remote list_connections. This MCP process waits without starting another connector.'
              : 'Run the DotX setup skill. This process will load the connector after local initialization.',
        },
    ),
  { onerror: () => process.stderr.write('dotx: MCP_STDIO_ERROR\n') },
);
function load() {
  if (runtime) return;
  if (!fs.existsSync(path.join(dir, 'config.json'))) return;
  try {
    diagnostic = 'CONNECTOR_LOCK_FAILED';
    if (!tryConnectorLock(dir)) {
      diagnostic = 'CONNECTOR_ACTIVE_ELSEWHERE';
      return;
    }
    diagnostic = 'CONNECTOR_START_FAILED';
    runtime = startDevice(() => stdio.close());
    clearInterval(timer);
  } catch (error) {
    process.stderr.write(`dotx: ${diagnostic} (${safeError(error).code})\n`);
    // Fatal startup errors must not leave a nonfunctional process holding the lock.
    process.exit(1);
  }
}
const timer = setInterval(() => {
  if (process.ppid !== parent || (pipe && !fs.existsSync(pipe))) process.exit(0);
  load();
}, 1000);
process.stdin.once('end', () => {
  if (!runtime && !pipe) process.exit(0);
});
load();
