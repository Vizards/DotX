import packageInfo from '../../package.json' with { type: 'json' };
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { eventCatalog } from '../events/catalog.ts';
import { updateAvailable } from '../updates/releases.ts';
import type { Caller } from '../hub/access.ts';
import { serveMcp } from './server.ts';
import type { Env } from '../env.ts';
import { hub } from '../hub/namespace.ts';

export async function handleMcp(request: Request, env: Env, identity: Caller) {
  const deviceHub = hub(env);
  return serveMcp(request, {
    publicOrigin: env.PUBLIC_ORIGIN,
    events: async (method, args) => {
      if (method === 'events/list') return { events: eventCatalog };
      const reply = await deviceHub.eventRequest(identity, method, args);
      if (!reply.ok) throw reply.error;
      return reply.result;
    },
    connections: async () => {
      const { result, updates, events, service, record_retention_days } =
        await deviceHub.connectionSummary(identity);
      return {
        server_version: packageInfo.version,
        wire_protocol: WIRE_VERSION,
        updates: {
          ...updates,
          server_update_available: updateAvailable(updates, packageInfo.version),
        },
        service,
        record_retention_days,
        connections: result.devices.map((d) => ({
          connection_id: d.deviceId,
          interfaces: d.interfaces,
          label: d.label,
          availability: d.availability,
          last_seen: d.lastSeen,
          desktop_version: d.desktopVersion,
          connector_version: d.connectorVersion,
          update_available: updateAvailable(updates, d.connectorVersion),
          diagnostic: d.diagnostic,
        })),
        freshness_ms: result.freshnessMs,
        events: events.ok
          ? events.result
          : {
              delivery: 'webhook',
              diagnostic: { code: 'EVENT_STORE_UNAVAILABLE', cause: events.error },
            },
      };
    },
    invoke: async (operation, args) => {
      const reply = await deviceHub.invoke(identity, operation, args);
      if (!reply.ok) throw reply.error;
      return reply.result;
    },
  });
}
