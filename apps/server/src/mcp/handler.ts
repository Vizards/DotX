import packageInfo from '../../package.json' with { type: 'json' };
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { eventCatalog } from '../events/schema.ts';
import { updateAvailable } from '../updates/discovery.ts';
import type { EventAuthority } from '../events/subscriptions.ts';
import { serveMcp } from './server.ts';
import type { Env, OAuthProps } from '../env.ts';
import { hub } from '../hub/namespace.ts';

const fail = (code: string, message = code) => Object.assign(new Error(message), { code });

export async function handleMcp(
  request: Request,
  env: Env,
  props: OAuthProps,
  scopes: string[],
  identity: Omit<EventAuthority, 'devices'>,
) {
  if (!props.owner) throw fail('OWNER_REQUIRED');
  const deviceHub = hub(env);
  // Static MCP discovery and guidance need OAuth, but no device registry read.
  const authority = async (): Promise<EventAuthority> => ({
    ...identity,
    devices: (await deviceHub.registry()).map((d) => d.id),
  });
  return serveMcp(request, {
    publicOrigin: env.PUBLIC_ORIGIN,
    scopes,
    events: async (method, args) => {
      if (method === 'events/list') return { events: eventCatalog };
      const reply = await deviceHub.eventRequest(await authority(), method, args);
      if (!reply.ok) throw reply.error;
      return reply.result;
    },
    connections: async () => {
      const auth = await authority();
      const { result, updates, events, service } = await deviceHub.connectionSummary(auth);
      return {
        server_version: packageInfo.version,
        wire_protocol: WIRE_VERSION,
        updates: {
          ...updates,
          server_update_available: updateAvailable(updates, packageInfo.version),
        },
        service,
        connections: result.devices
          .filter((x) => auth.devices.includes(x.deviceId))
          .map((d) => ({
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
      const { devices } = await authority();
      const reply = await deviceHub.invoke({ principal: 'owner', devices }, operation, args);
      if (!reply.ok) throw reply.error;
      return reply.result;
    },
  });
}
