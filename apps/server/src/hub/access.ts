import { BridgeError } from '@dotx/shared/errors';
import type { EventAuthority } from '../events/subscriptions.ts';
import type { Agents, GrantIdentity } from './agents.ts';
export type Caller = Omit<EventAuthority, 'devices'>;
export function grantIdentity(auth: Caller): GrantIdentity | null {
  return auth.user_id && auth.client_id && auth.grant_id
    ? {
        agent_id: auth.user_id,
        client_id: auth.client_id,
        grant_id: auth.grant_id,
      }
    : null;
}
export async function requireAccess(agents: Agents, auth: Caller) {
  const identity = grantIdentity(auth);
  if (!identity || !(await agents.active(identity)))
    throw new BridgeError('AGENT_AUTHORIZATION_REVOKED');
}
