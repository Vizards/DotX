import type { Env } from '../env.ts';
import { control } from '../hub/namespace.ts';
// Version-pinned provider 1.2.3 format: userId:grantId:secret. Only call after SDK verification.
export const providerGrantId = (token: string) => token.split(':')[1] ?? '';
export async function cleanEndedGrants(env: Env) {
  for (const entry of await control<{ userId: string; grantId: string }[]>(
    env,
    'grants/ended',
    {},
  )) {
    try {
      await env.OAUTH_PROVIDER.revokeGrant(entry.grantId, entry.userId);
      await control(env, 'grants/cleaned', entry);
    } catch {
      /* DO rejects the ended authorization even if provider cleanup is unavailable. */
    }
  }
}
