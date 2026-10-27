import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { DeviceHub } from './hub/device-hub.ts';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import type { ServiceInfo } from '@dotx/shared/http/service';
import packageInfo from '../package.json' with { type: 'json' };
export interface Env {
  OAUTH_KV: KVNamespace;
  DEVICES: DurableObjectNamespace<DeviceHub>;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
  SERVICE_ID: string;
  CF_ACCOUNT_ID: string;
  CF_WORKER_ID: string;
  CF_WORKER_NAME: string;
  OAUTH_PROVIDER: OAuthHelpers;
  RELEASE_REPOSITORY?: string;
  RELEASE_CHANNEL?: string;
  RECORD_RETENTION_DAYS?: string;
  DOTX_ADMIN_CLAIM?: string;
}
export function serviceInfo(env: Env): ServiceInfo {
  return {
    product: 'dotx',
    origin: env.PUBLIC_ORIGIN,
    service_id: env.SERVICE_ID,
    version: packageInfo.version,
    wire_protocol: WIRE_VERSION,
    mcp_url: env.PUBLIC_ORIGIN + '/mcp',
    guides_url: `https://github.com/Vizards/DotX/blob/v${packageInfo.version}/docs/index.md`,
  };
}
