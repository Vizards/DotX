import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { HttpError } from '../http/responses.ts';
import { qualification, type Membership } from './permissions.ts';
import type { Env } from '../env.ts';
const WRANGLER_CLIENT_ID = '54d11594-84e4-41aa-b438-e81b8fa78ee7';
const DASH = 'https://dash.cloudflare.com';
const API = 'https://api.cloudflare.com/client/v4';
interface ApiResult<T> {
  success: boolean;
  result: T;
  result_info?: { total_pages?: number; total_count?: number };
}
async function upstream<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, 'CF_UNAVAILABLE', 'Cloudflare could not be reached. Try again later.');
  }
  if (response.status === 429 || response.status >= 500)
    throw new HttpError(
      503,
      'CF_UNAVAILABLE',
      'Cloudflare is temporarily unavailable. Try again later.',
    );
  if (response.status === 401)
    throw new HttpError(401, 'CF_LOGIN_REQUIRED', 'Sign in to Cloudflare again.');
  if (response.status === 403)
    throw new HttpError(403, 'CF_ACCESS_DENIED', 'Cloudflare denied access to this resource.');
  if (!response.ok) throw new HttpError(503, 'CF_RESPONSE_INVALID');
  try {
    return await response.json<T>();
  } catch {
    throw new HttpError(503, 'CF_RESPONSE_INVALID');
  }
}
const read = <T>(url: string, token: string) =>
  upstream<T>(url, { headers: { Authorization: `Bearer ${token}` } });
export async function checkCloudflare(token: string, env: Env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_WORKER_ID)
    throw new HttpError(503, 'MANAGEMENT_NOT_CONFIGURED');
  const identity = await read<{ iss: string; aud: string | string[]; sub: string }>(
    `${DASH}/oauth2/userinfo`,
    token,
  );
  const audiences = Array.isArray(identity.aud) ? identity.aud : [identity.aud];
  if (
    identity.iss !== DASH ||
    audiences.length !== 1 ||
    audiences[0] !== WRANGLER_CLIENT_ID ||
    typeof identity.sub !== 'string'
  )
    throw new HttpError(401, 'CF_IDENTITY_INVALID');
  let member: Membership | undefined;
  for (let page = 1; page <= 20; page++) {
    const list = await read<ApiResult<Membership[]>>(
      `${API}/memberships?per_page=50&page=${page}`,
      token,
    );
    if (!list.success || !Array.isArray(list.result))
      throw new HttpError(503, 'CF_MEMBERSHIPS_UNAVAILABLE');
    member = list.result.find((m) => m.account?.id === env.CF_ACCOUNT_ID);
    if (member) break;
    const totalPages =
      list.result_info?.total_pages ??
      (list.result_info?.total_count === undefined
        ? undefined
        : Math.ceil(list.result_info.total_count / 50));
    if (totalPages === undefined ? list.result.length < 50 : page >= totalPages) break;
    if (page === 20) throw new HttpError(503, 'CF_MEMBERSHIPS_LIMIT');
  }
  if (!member)
    throw new HttpError(
      403,
      'NOT_A_TARGET_ACCOUNT_MEMBER',
      'This identity cannot manage this Worker.',
    );
  if (member.policies === undefined) {
    const detail = await read<ApiResult<Membership>>(
      `${API}/memberships/${encodeURIComponent(member.id)}`,
      token,
    );
    if (!detail.success || !detail.result) throw new HttpError(503, 'CF_MEMBERSHIP_UNAVAILABLE');
    member = detail.result;
  }
  const reason = qualification(member, env.CF_ACCOUNT_ID, env.CF_WORKER_ID);
  if (!reason)
    throw new HttpError(
      403,
      'TARGET_WORKER_MANAGEMENT_REQUIRED',
      'Direct permission to modify this Worker is required. Group-only permission is not supported.',
    );
  return { subject: identity.sub, qualification: reason };
}
