import { serviceInfoSchema, type ServiceInfo } from '@dotx/shared/service';
import { api, serviceOrigin } from './state.ts';

// The host calls the already authorized account MCP. The installer receives only
// its non-secret service object, never ChatGPT OAuth credentials.
export async function resolveService(
  input: { discovery?: unknown; url?: string; savedOrigin?: string },
  readInfo: (origin: string) => Promise<unknown> = (origin) => api(origin, '/setup/info'),
): Promise<ServiceInfo> {
  if (input.discovery !== undefined && input.url !== undefined)
    throw new Error('CHOOSE_ONE_SERVICE_SOURCE');
  const discovered =
    input.discovery === undefined ? undefined : serviceInfoSchema.parse(input.discovery);
  const selected = discovered?.origin ?? input.url ?? input.savedOrigin;
  if (!selected)
    throw new Error('SERVICE_DISCOVERY_REQUIRED: call the account DotX Remote list_connections');
  const origin = serviceOrigin(selected);
  if (input.savedOrigin && input.savedOrigin !== origin)
    throw new Error('SERVICE_IDENTITY_CHANGED');
  const info = serviceInfoSchema.parse(await readInfo(origin));
  if (info.origin !== origin) throw new Error('SERVICE_ORIGIN_MISMATCH');
  return info;
}
