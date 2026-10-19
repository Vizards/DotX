import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { DeviceHub } from './hub/device-hub.ts';
// Secrets are explicit: `wrangler types` on a fresh checkout need not read local credentials.
export interface Env {
  OAUTH_KV: KVNamespace;
  PUBLIC_ORIGIN: string;
  RELEASE_REPOSITORY?: string;
  RELEASE_CHANNEL?: 'stable' | 'dev';
  DEVICES: DurableObjectNamespace<DeviceHub>;
  OWNER_KEY_HASH: string;
  OAUTH_PROVIDER: OAuthHelpers;
}
export interface OAuthProps {
  owner: true;
}
