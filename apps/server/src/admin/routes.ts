import type { Env } from '../env.ts';
import { serviceInfo } from '../env.ts';
import { control, hub } from '../hub/namespace.ts';
import { authenticate, authenticateSession } from './authenticate.ts';
import {
  clearSession,
  browserAuthority,
  sessionResponse,
  cookie,
  setCookie,
  SESSION_COOKIE,
} from './sessions.ts';
import { sessionSeconds, type BrowserSession } from './credentials.ts';
import { HttpError, json, failure } from '../http/responses.ts';
import { cleanEndedGrants } from '../oauth/grants.ts';
export async function adminRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/admin/')) return null;
  if (path !== '/admin/logout' && !path.startsWith('/admin/api/')) return null;
  let renewedCookie: string | undefined;
  const respond = (response: Response) => {
    if (renewedCookie && !response.headers.has('Set-Cookie')) {
      response = new Response(response.body, response);
      response.headers.set('Set-Cookie', renewedCookie);
    }
    return response;
  };
  try {
    if (path === '/admin/logout' && request.method === 'POST') {
      await authenticateSession(request, env);
      return json({ ok: true }, 200, { 'Set-Cookie': await clearSession(request, env) });
    }
    if (
      ['/admin/api/setup', '/admin/api/reset-login'].includes(path) &&
      request.method === 'POST'
    ) {
      if (!request.headers.has('Authorization'))
        throw new HttpError(401, 'WRANGLER_OAUTH_REQUIRED');
      await authenticate(request, env);
      return json(await control(env, 'admin/issue', { reset: path === '/admin/api/reset-login' }));
    }
    const actor = await authenticate(request, env);
    if (actor.qualification === 'browser')
      renewedCookie = setCookie(
        env,
        SESSION_COOKIE,
        cookie(request, SESSION_COOKIE)!,
        sessionSeconds,
      );
    if (path === '/admin/api/setup' && request.method === 'GET')
      return respond(json(await control(env, 'admin/status', {})));
    if (path === '/admin/api/session' && request.method === 'GET')
      return respond(
        json({
          authenticated: true,
          login_configured: (await control<{ configured: boolean }>(env, 'admin/status', {}))
            .configured,
          ...actor,
          account_id: env.CF_ACCOUNT_ID,
          worker: env.CF_WORKER_NAME,
          service: serviceInfo(env),
        }),
      );
    if (path === '/admin/api/security' && request.method === 'GET')
      return respond(json(await control(env, 'admin/security', {})));
    const removal = /^\/admin\/api\/(password|passkeys\/([^/]+))$/.exec(path);
    if (removal && request.method === 'DELETE') {
      const session = await control<BrowserSession & { secret: string }>(env, 'admin/remove', {
        auth: await browserAuthority(request),
        passkeyId: removal[2],
      });
      return sessionResponse(env, session);
    }
    if (path.startsWith('/admin/api/')) {
      const response = await hub(env).fetch(
        new Request(request.url, {
          method: request.method,
          headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' },
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        }),
      );
      if (response.ok && !['GET', 'HEAD'].includes(request.method))
        ctx.waitUntil(cleanEndedGrants(env));
      return respond(response);
    }
    throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    const response = failure(error);
    if (
      error instanceof HttpError &&
      [401, 403].includes(error.status) &&
      error.code !== 'CSRF_REQUIRED' &&
      !request.headers.has('Authorization')
    )
      response.headers.set('Set-Cookie', await clearSession(request, env));
    return respond(response);
  }
}
