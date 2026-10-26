import { parseArgs } from 'node:util';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { wranglerToken, workerIdentity, createWorker } from './wrangler.ts';
const help =
  'admin.mjs --url HTTPS_ORIGIN [--profile WRANGLER_PROFILE] session | setup | setup-status | agents | agent-create --name NAME | agent-rename --id ID --name NAME | agent-reissue --id ID | agent-cancel --id ID | agent-revoke --id ID | devices | device-requests | device-approve --id OPERATION_ID | device-reject --id OPERATION_ID | device-revoke --id DEVICE_ID; installation: admin.mjs worker-identity | worker-create --account ACCOUNT_ID --worker NAME [--profile WRANGLER_PROFILE]';
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      profile: { type: 'string' },
      name: { type: 'string' },
      id: { type: 'string' },
      account: { type: 'string' },
      worker: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { usage: help };
  if (positionals.length === 1 && positionals[0] === 'worker-identity')
    return workerIdentity(values.account ?? '', values.worker ?? '', values.profile);
  if (positionals.length === 1 && positionals[0] === 'worker-create')
    return createWorker(values.account ?? '', values.worker ?? '', values.profile);
  if (positionals.length !== 1 || !values.url) throw new Error(help);
  const url = new URL(values.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !['', '/'].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error('INVALID_SERVER_ORIGIN');
  const id = () => {
    if (!values.id) throw new Error('ID_REQUIRED');
    return encodeURIComponent(values.id);
  };
  const name = () => {
    const name = values.name?.trim();
    if (!name || name.length > 100) throw new Error('NAME_REQUIRED_1_TO_100_CHARACTERS');
    return { name };
  };
  let method = 'GET',
    path: string,
    body: unknown;
  switch (positionals[0]) {
    case 'setup':
      path = '/setup';
      method = 'POST';
      break;
    case 'setup-status':
      path = '/setup';
      break;
    case 'session':
      path = '/session';
      break;
    case 'agents':
      path = '/agents';
      break;
    case 'agent-create':
      path = '/agents';
      method = 'POST';
      body = name();
      break;
    case 'agent-rename':
      path = `/agents/${id()}`;
      method = 'PATCH';
      body = name();
      break;
    case 'agent-reissue':
      path = `/agents/${id()}/enrollment-code`;
      method = 'POST';
      break;
    case 'agent-cancel':
      path = `/agents/${id()}/enrollment-code`;
      method = 'DELETE';
      break;
    case 'agent-revoke':
      path = `/agents/${id()}/revoke`;
      method = 'POST';
      break;
    case 'devices':
      path = '/devices';
      break;
    case 'device-requests':
      path = '/device-requests';
      break;
    case 'device-approve':
      path = `/device-requests/${id()}/approve`;
      method = 'POST';
      break;
    case 'device-reject':
      path = `/device-requests/${id()}/reject`;
      method = 'POST';
      break;
    case 'device-revoke':
      path = `/devices/${id()}/revoke`;
      method = 'POST';
      break;
    default:
      throw new Error(help);
  }
  const token = await wranglerToken(values.profile);
  let response: Response;
  try {
    response = await fetch(url.origin + '/admin/api' + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new Error(
      method === 'GET'
        ? 'MANAGEMENT_UNREACHABLE'
        : 'MANAGEMENT_OUTCOME_UNKNOWN: read current state before deciding whether to retry',
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('MANAGEMENT_RESPONSE_INVALID');
  }
  if (!response.ok) process.exitCode = 1;
  return { status: response.status, result };
}
try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.error(
    JSON.stringify({
      error: { code: error instanceof Error ? error.message : 'MANAGEMENT_FAILED' },
    }),
  );
  process.exitCode = 1;
}
