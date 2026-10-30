import { serviceInfoSchema } from '@dotx/shared/http/service';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
export async function serviceInfo(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error('HTTPS_SERVICE_ORIGIN_REQUIRED');
  const response = await fetch(url.origin + '/setup/info', {
    redirect: 'error',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('SERVICE_DISCOVERY_FAILED:' + response.status);
  const service = serviceInfoSchema.parse(await response.json());
  if (service.origin !== url.origin || service.mcp_url !== url.origin + '/mcp')
    throw new Error('SERVICE_IDENTITY_MISMATCH');
  return service;
}
