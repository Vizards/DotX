import type { Env } from '../env.ts';
import type { DeviceHub } from './device-hub.ts';

type HubRpc = Pick<DeviceHub, 'registry' | 'connectionSummary' | 'eventRequest' | 'invoke'>;

// A single hub per deployment namespace, with no placement preference.
export function hub(env: Pick<Env, 'DEVICES'>) {
  // These methods return plain data. Cloudflare's recursive stub types reject
  // our opaque `unknown` native payloads; retain the method types without adding
  // another schema or converting those payloads for transport.
  return env.DEVICES.getByName('devices') as DurableObjectStub & HubRpc;
}
