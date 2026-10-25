import { spawn } from 'node:child_process';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import packageInfo from '../package.json' with { type: 'json' };

// Only the official CLI may load or refresh its credentials. Never expose its
// stdout/stderr, which can contain the exported token or provider diagnostics.
export async function wranglerToken(profile?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        'dlx',
        `wrangler@${packageInfo.devDependencies.wrangler}`,
        'auth',
        'token',
        '--json',
        ...(profile ? ['--profile', profile] : []),
      ],
      {
        env: {
          ...process.env,
          CI: '1',
          WRANGLER_SEND_METRICS: 'false',
          WRANGLER_WRITE_LOGS: 'false',
          WRANGLER_LOG: 'log',
          FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '',
      failure: string | undefined;
    const timer = setTimeout(() => {
      failure = 'WRANGLER_TIMEOUT';
      child.kill('SIGTERM');
    }, DEFAULT_TIMEOUT_MS * 2);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('WRANGLER_START_FAILED: pnpm must be available on PATH'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) {
        reject(
          new Error(
            failure ??
              'WRANGLER_LOGIN_REQUIRED: run official wrangler login using the intended profile',
          ),
        );
        return;
      }
      try {
        const value = JSON.parse(output);
        if (value.type !== 'oauth' || typeof value.token !== 'string' || !value.token)
          throw new Error();
        resolve(value.token);
      } catch {
        reject(new Error('WRANGLER_OAUTH_REQUIRED: API tokens and global keys are not accepted'));
      }
    });
  });
}

// Resolve or create the resource before deploying code. These primitives do not
// modify existing Workers, write local configuration or orchestrate deployment.
export async function workerIdentity(account: string, name: string, profile?: string) {
  return workerResource(account, name, 'GET', profile);
}
export async function createWorker(account: string, name: string, profile?: string) {
  return workerResource(account, name, 'POST', profile);
}
async function workerResource(
  account: string,
  name: string,
  method: 'GET' | 'POST',
  profile?: string,
) {
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
    throw new Error('ACCOUNT_AND_WORKER_NAME_REQUIRED');
  const token = await wranglerToken(profile);
  const action = method === 'GET' ? 'LOOKUP' : 'CREATE';
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers${method === 'GET' ? '/' + name : ''}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ name }) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error(
      method === 'GET'
        ? 'CF_WORKER_LOOKUP_UNREACHABLE'
        : 'CF_WORKER_CREATE_OUTCOME_UNKNOWN: look up the Worker by name before retrying',
    );
  }
  if (!response.ok) throw new Error(`CF_WORKER_${action}_HTTP_${response.status}`);
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: { name: string; id: string };
  } | null;
  if (!body?.success || body.result?.name !== name || !/^[a-f0-9]{32}$/.test(body.result.id))
    throw new Error(
      method === 'GET'
        ? 'CF_WORKER_LOOKUP_INVALID'
        : 'CF_WORKER_CREATE_OUTCOME_UNKNOWN: look up the Worker by name before retrying',
    );
  return { account_id: account, worker_name: name, worker_id: body.result.id };
}
