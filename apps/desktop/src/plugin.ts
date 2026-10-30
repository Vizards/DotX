import fs from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDeviceMcp } from './mcp.ts';
import { Runtime } from './runtime.ts';
import { dataDir, pluginRoot } from './local/paths.ts';
import { errorValue } from '@dotx/shared/errors';
import packageInfo from '../package.json' with { type: 'json' };
process.umask(0o077);
const parent = process.ppid,
  pipe = process.env.CODEX_APP_TOOLS_PIPE_PATH;
let runtime: Runtime | undefined, initialError: unknown;
try {
  const dir = dataDir(),
    root = pluginRoot();
  process.chdir(dir);
  runtime = new Runtime(dir, root);
} catch (error) {
  initialError = errorValue(error);
}
const stdio = serveStdio(
  () =>
    createDeviceMcp(
      async () =>
        runtime?.status() ?? {
          entry: { role: 'unavailable', version: packageInfo.version, pid: process.pid },
          data_dir: null,
          owner: null,
          diagnostic: initialError,
        },
    ),
  {
    onerror: (error) =>
      process.stderr.write(
        JSON.stringify({ code: 'MCP_STDIO_ERROR', cause: errorValue(error) }) + '\n',
      ),
  },
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await runtime?.stop();
  await stdio.close();
  process.exit(0);
}
const timer = setInterval(() => {
  if (process.ppid !== parent || (pipe && !fs.existsSync(pipe))) {
    void stop();
    return;
  }
  void runtime?.start();
}, 1000);
process.stdin.once('end', () => {
  if (!pipe) void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
process.once('SIGINT', () => {
  void stop();
});
void runtime?.start();
