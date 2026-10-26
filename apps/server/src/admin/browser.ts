import type { Env } from '../env.ts';
import type { BrowserSession } from './credentials.ts';
import { control } from '../hub/namespace.ts';
import { readJson } from '../http/body.ts';
import { randomSecret, sha256 } from '../http/crypto.ts';
import { HttpError, failure, json } from '../http/responses.ts';
import {
  browserAuthority,
  cookie,
  CEREMONY_COOKIE,
  ceremonyCookie,
  sessionResponse,
  clearSession,
} from './sessions.ts';

export async function browserRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/admin/auth/') && path !== '/setup/admin/api') return null;
  try {
    if (request.headers.has('Authorization')) throw new HttpError(400, 'BROWSER_AUTH_REQUIRED');
    if (path === '/admin/auth/methods' && request.method === 'GET')
      return json(await control(env, 'admin/status', {}));
    if (path === '/setup/admin/api' && request.method === 'GET')
      return json(
        await control(env, 'admin/context', {
          hash: await sha256(request.headers.get('X-DotX-Setup') ?? ''),
        }),
      );
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN) throw new HttpError(403, 'BAD_ORIGIN');
    const body = (await readJson(request)) as Record<string, any> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new HttpError(400, 'INVALID_JSON');
    if (path.endsWith('/options')) {
      const raw = cookie(request, CEREMONY_COOKIE) ?? randomSecret();
      const id = await sha256(raw);
      let options;
      if (path === '/admin/auth/passkey/options')
        options = await control(env, 'admin/passkey-options', { id });
      else if (path === '/admin/auth/passkey/register/options')
        options = await control(env, 'admin/register-options', {
          id,
          auth: await browserAuthority(request),
        });
      else throw new HttpError(404, 'NOT_FOUND');
      return json(options, 200, { 'Set-Cookie': ceremonyCookie(env, raw) });
    }
    let operation: string;
    let input: unknown;
    if (path === '/admin/auth/password') {
      operation = 'admin/login-password';
      input = { password: body.password };
    } else if (path === '/admin/auth/password/set') {
      operation = 'admin/set-password';
      input = { auth: await browserAuthority(request), password: body.password };
    } else if (
      ['/admin/auth/passkey/verify', '/admin/auth/passkey/register/verify'].includes(path)
    ) {
      const raw = cookie(request, CEREMONY_COOKIE);
      if (!raw) throw new HttpError(401, 'PASSKEY_REQUEST_EXPIRED');
      const id = await sha256(raw);
      if (path === '/admin/auth/passkey/verify') {
        operation = 'admin/login-passkey';
        input = { id, response: body.response };
      } else {
        operation = 'admin/register';
        input = {
          id,
          response: body.response,
          name: body.name,
          auth: await browserAuthority(request),
        };
      }
    } else throw new HttpError(404, 'NOT_FOUND');
    const session = await control<BrowserSession & { secret: string }>(env, operation, input);
    await clearSession(request, env);
    return sessionResponse(env, session);
  } catch (error) {
    return failure(error);
  }
}
