import type { Env } from '../env.ts';
import { HttpError } from '../http/responses.ts';
import { checkCloudflare } from './cloudflare.ts';
import { cookie, sessionId, SESSION_COOKIE } from './sessions.ts';
import { control } from '../hub/namespace.ts';
import type { BrowserSession } from './credentials.ts';
export async function authenticate(request: Request, env: Env) {
  const header = request.headers.get('Authorization');
  if (header && cookie(request, SESSION_COOKIE))
    throw new HttpError(400, 'MIXED_ADMIN_CREDENTIALS');
  if (header) {
    const token = /^Bearer ([^\s]+)$/.exec(header)?.[1];
    if (!token) throw new HttpError(401, 'WRANGLER_OAUTH_REQUIRED');
    return {
      ...(await checkCloudflare(token, env)),
      csrf_token: null,
      expires_at: null,
    };
  }
  const session = await authenticateSession(request, env);
  return {
    subject: 'administrator',
    qualification: 'browser',
    csrf_token: session.csrf,
    expires_at: session.expires_at,
  };
}

// Browser administration is independent of Cloudflare account membership.
export async function authenticateSession(request: Request, env: Env) {
  if (request.headers.has('Authorization')) throw new HttpError(400, 'BROWSER_SESSION_REQUIRED');
  const id = await sessionId(request);
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    request.headers.get('Origin') !== env.PUBLIC_ORIGIN
  )
    throw new HttpError(403, 'CSRF_REQUIRED', 'Refresh the management page before retrying.');
  return control<BrowserSession>(env, 'admin/session', {
    id,
    csrf: ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : (request.headers.get('X-CSRF-Token') ?? ''),
  });
}
