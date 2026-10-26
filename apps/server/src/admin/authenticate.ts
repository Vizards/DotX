import { requireClient } from './config.ts';
import type { Env } from '../env.ts';
import { HttpError } from '../http/responses.ts';
import { sameSecret } from '../http/crypto.ts';
import { checkCloudflare, WRANGLER_CLIENT_ID } from './cloudflare.ts';
import { cookie, readSession, currentSession, SESSION_COOKIE } from './sessions.ts';
export async function authenticate(request: Request, env: Env) {
  const header = request.headers.get('Authorization');
  if (header && cookie(request, SESSION_COOKIE))
    throw new HttpError(400, 'MIXED_ADMIN_CREDENTIALS');
  if (header) {
    const token = /^Bearer ([^\s]+)$/.exec(header)?.[1];
    if (!token) throw new HttpError(401, 'WRANGLER_OAUTH_REQUIRED');
    return {
      ...(await checkCloudflare(token, WRANGLER_CLIENT_ID, env)),
      csrf_token: null,
      expires_at: null,
    };
  }
  await authenticateSession(request, env);
  let session = await currentSession(request, env);
  const client = await requireClient(env);
  let identity: Awaited<ReturnType<typeof checkCloudflare>>;
  try {
    identity = await checkCloudflare(session.token, client.client_id, env);
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== 'CF_LOGIN_REQUIRED') throw error;
    // CF may reject a token before our expiry check observes it. Refresh once;
    // the management action has not started and is never retried here.
    session = await currentSession(request, env, session.token);
    identity = await checkCloudflare(session.token, client.client_id, env);
  }
  return {
    ...identity,
    csrf_token: session.csrf,
    expires_at: session.expiresAt,
  };
}
// Browser session checks do not require Cloudflare to be reachable. Logging out
// only removes this session; management actions additionally check CF authority.
export async function authenticateSession(request: Request, env: Env) {
  if (request.headers.has('Authorization')) throw new HttpError(400, 'BROWSER_SESSION_REQUIRED');
  const session = await readSession(request, env);
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    (request.headers.get('Origin') !== env.PUBLIC_ORIGIN ||
      !sameSecret(request.headers.get('X-CSRF-Token') ?? '', session.csrf))
  )
    throw new HttpError(403, 'CSRF_REQUIRED', 'Refresh the management page before retrying.');
  return session;
}
