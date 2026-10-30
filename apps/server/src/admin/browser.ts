import type { Env } from '../env.ts';
import type { BrowserSession } from './credentials.ts';
import type { AdminClaim } from '@dotx/shared/http/admin';
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
  CLAIM_COOKIE,
  setCookie,
} from './sessions.ts';

export async function browserRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith('/admin/auth/') &&
    !path.startsWith('/admin/api/claim/') &&
    path !== '/setup/admin/api'
  )
    return null;
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
    if (path === '/admin/api/claim/start' || path === '/admin/api/claim/verify') {
      // Copy/paste may add surrounding whitespace; preserve the challenge itself.
      const deployedChallenge = env.DOTX_ADMIN_CLAIM?.trim();
      const previous = cookie(request, CLAIM_COOKIE);
      const id = previous ? await sha256(previous) : undefined;
      let claim: AdminClaim | null;
      let claimCookie: string | undefined;
      if (path.endsWith('/start')) {
        const raw = randomSecret();
        const result = await control<{ claim: AdminClaim; created: boolean }>(
          env,
          'admin/claim-start',
          {
            id,
            nextId: await sha256(raw),
            restart: body.restart === true,
          },
        );
        claim = result.claim;
        claimCookie = setCookie(
          env,
          CLAIM_COOKIE,
          result.created ? raw : previous!,
          Math.max(0, Math.ceil((claim.expires_at - Date.now()) / 1000)),
        );
      } else {
        // Use this request's deployed binding, never a cached value or public input.
        claim = await control<AdminClaim | null>(env, 'admin/claim-verify', {
          id,
          deployedChallenge,
        });
      }
      return json(
        {
          claim,
          secret_name: 'DOTX_ADMIN_CLAIM',
          secret_present: !!deployedChallenge,
          // Report only an actionable shape error, never the deployed value.
          value_format_issue: deployedChallenge?.startsWith('DOTX_ADMIN_CLAIM=')
            ? 'name_in_value'
            : null,
          settings_url: `https://dash.cloudflare.com/${encodeURIComponent(env.CF_ACCOUNT_ID)}/workers/services/view/${encodeURIComponent(env.CF_WORKER_NAME)}/production/settings#variables`,
          worker: env.CF_WORKER_NAME,
        },
        200,
        claimCookie ? { 'Set-Cookie': claimCookie } : undefined,
      );
    }
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
