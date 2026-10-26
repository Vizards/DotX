import type { Env } from '../env.ts';
import { serviceInfo } from '../env.ts';
import { readClient, requireClient } from './config.ts';
import { control, hub } from '../hub/namespace.ts';
import { authenticate, authenticateSession } from './authenticate.ts';
import { startLogin, finishLogin, createSession, clearSession } from './sessions.ts';
import { LOGIN_COOKIE, setCookie } from './sessions.ts';
import { checkCloudflare, exchangeCode } from './cloudflare.ts';
import { HttpError, json, failure } from '../http/responses.ts';
import { cleanEndedGrants } from '../oauth/grants.ts';
export async function adminRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/admin/')) return null;
  if (
    !['/admin/login', '/admin/callback', '/admin/logout'].includes(path) &&
    !path.startsWith('/admin/api/')
  )
    return null;
  try {
    if (path === '/admin/login' && request.method === 'GET') return await startLogin(request, env);
    if (path === '/admin/callback' && request.method === 'GET') {
      const transaction = await finishLogin(request, env),
        code = new URL(request.url).searchParams.get('code');
      if (!code) throw new HttpError(401, 'CF_LOGIN_CANCELLED');
      const client = await requireClient(env);
      const started = Date.now(),
        token = await exchangeCode(code, transaction.verifier, env, client);
      await checkCloudflare(token.access_token, client.client_id, env);
      const remaining = Math.floor((started + token.expires_in * 1000 - Date.now()) / 1000);
      if (remaining <= 0) throw new HttpError(401, 'CF_LOGIN_EXPIRED');
      const session = await createSession(env, token, started + token.expires_in * 1000);
      await clearSession(request, env);
      const response = new Response(null, {
        status: 303,
        headers: {
          ...session.headers,
          Location: transaction.returnTo,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
      response.headers.append('Set-Cookie', setCookie(env, LOGIN_COOKIE, '', 0));
      return response;
    }
    if (path === '/admin/logout' && request.method === 'POST') {
      await authenticateSession(request, env);
      return json({ ok: true }, 200, { 'Set-Cookie': await clearSession(request, env) });
    }
    if (path === '/admin/api/setup' && request.method === 'POST') {
      if (!request.headers.has('Authorization'))
        throw new HttpError(401, 'WRANGLER_OAUTH_REQUIRED');
      await authenticate(request, env);
      return json(await control(env, 'admin-setup/issue', {}));
    }
    if (path === '/admin/api/setup' && request.method === 'GET') {
      await authenticate(request, env);
      return json(await control(env, 'admin-setup/status', {}));
    }
    if (
      path === '/admin/api/session' &&
      !request.headers.has('Authorization') &&
      !(await readClient(env))
    )
      throw new HttpError(503, 'CF_LOGIN_NOT_CONFIGURED');
    const actor = await authenticate(request, env);
    if (path === '/admin/api/session' && request.method === 'GET')
      return json({
        authenticated: true,
        login_configured: !!(await readClient(env)),
        ...actor,
        account_id: env.CF_ACCOUNT_ID,
        worker: env.CF_WORKER_NAME,
        service: serviceInfo(env),
      });
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
      return response;
    }
    throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    if (['/admin/login', '/admin/callback'].includes(path)) {
      const response = new Response(null, {
        status: 303,
        headers: {
          Location:
            '/admin?login_error=' +
            encodeURIComponent(error instanceof HttpError ? error.code : 'CF_LOGIN_FAILED'),
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
      response.headers.append('Set-Cookie', setCookie(env, LOGIN_COOKIE, '', 0));
      return response;
    }
    const response = failure(error);
    if (
      error instanceof HttpError &&
      [401, 403].includes(error.status) &&
      error.code !== 'CSRF_REQUIRED' &&
      !request.headers.has('Authorization')
    )
      response.headers.set('Set-Cookie', await clearSession(request, env));
    return response;
  }
}
