import fs from 'node:fs';
import path from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDeviceMcp } from './mcp/server.ts';
import { stateDir } from './runtime/state.ts';
import { startDevice } from './runtime/runtime.ts';

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
          availability: 'unavailable',
          diagnostic: { code: diagnostic },
          setup:
            'Run the DotX setup skill. This process will load the connector after local initialization.',
        },
    ),
  { onerror: () => process.stderr.write('dotx: MCP_STDIO_ERROR\n') },
);
function load() {
  if (runtime) return;
  if (!fs.existsSync(path.join(dir, 'config.json'))) return;
  try {
    runtime = startDevice(() => stdio.close());
    clearInterval(timer);
  } catch {
    diagnostic = 'SETUP_CONFIG_INVALID';
    clearInterval(timer);
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
