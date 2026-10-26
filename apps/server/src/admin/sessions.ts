import type { Env } from '../env.ts';
import type { BrowserSession, BrowserAuthority } from './credentials.ts';
import { sessionSeconds, ceremonySeconds } from './credentials.ts';
import { control } from '../hub/namespace.ts';
import { sha256 } from '../http/crypto.ts';
import { HttpError, json } from '../http/responses.ts';
export const SESSION_COOKIE = 'dotx-admin';
export const CEREMONY_COOKIE = 'dotx-admin-passkey';
export function cookie(request: Request, name: string) {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1);
}
export function setCookie(env: Env, name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${env.PUBLIC_ORIGIN.startsWith('https:') ? '; Secure' : ''}`;
}
export async function sessionId(request: Request) {
  const value = cookie(request, SESSION_COOKIE);
  if (!value)
    throw new HttpError(401, 'ADMIN_LOGIN_REQUIRED', 'Sign in with your DotX password or passkey.');
  return sha256(value);
}
export async function clearSession(request: Request, env: Env) {
  const value = cookie(request, SESSION_COOKIE);
  if (value) await control(env, 'admin/logout', { id: await sha256(value) });
  return setCookie(env, SESSION_COOKIE, '', 0);
}
export async function browserAuthority(request: Request): Promise<BrowserAuthority> {
  if (request.headers.has('Authorization')) throw new HttpError(400, 'BROWSER_SESSION_REQUIRED');
  const setup = request.headers.get('X-DotX-Setup');
  if (setup) return { setup: await sha256(setup) };
  return { session: await sessionId(request), csrf: request.headers.get('X-CSRF-Token') ?? '' };
}
export function sessionResponse(env: Env, session: BrowserSession & { secret: string }) {
  const response = json({ ok: true }, 200, {
    'Set-Cookie': setCookie(env, SESSION_COOKIE, session.secret, sessionSeconds),
  });
  response.headers.append('Set-Cookie', setCookie(env, CEREMONY_COOKIE, '', 0));
  return response;
}
export const ceremonyCookie = (env: Env, value: string) =>
  setCookie(env, CEREMONY_COOKIE, value, ceremonySeconds);
