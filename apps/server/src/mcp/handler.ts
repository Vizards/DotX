import packageInfo from '../../package.json' with { type: 'json' };
import { WIRE_VERSION } from '@dotx/shared/gateway';
import { updateAvailable, type ReleaseDiscovery } from '../updates/discovery.ts';
import type { EventAuthority } from '../events/subscriptions.ts';
import { serveMcp } from './server.ts';
import type { Env, OAuthProps } from '../env.ts';
import type { DeviceList, Outcome } from '@dotx/shared/protocol';
import type { ServiceInfo } from '@dotx/shared/service';
import { hub, registered } from '../hub/namespace.ts';

const fail = (code: string, message = code) => Object.assign(new Error(message), { code });

export async function handleMcp(
  request: Request,
  env: Env,
  props: OAuthProps,
  scopes: string[],
  eventAuth: EventAuthority,
) {
  if (!props.owner) throw fail('OWNER_REQUIRED');
  const allowed = (await registered(env)).map((d) => d.id);
  return serveMcp(request, {
    scopes,
    events: async (method, args) => {
      const result = await (
        await hub(env).fetch('https://hub/events', {
          method: 'POST',
          body: JSON.stringify({ auth: eventAuth, method, args }),
        })
      ).json<{
        ok: boolean;
        result: object;
        error: { code: string | number; message?: string; data?: unknown };
      }>();
      if (!result.ok && typeof result.error === 'string') throw fail(result.error);
      if (!result.ok)
        throw Object.assign(
          new Error(result.error.message ?? String(result.error.code)),
          result.error,
        );
      return result.result;
    },
    connections: async () => {
      const result = await (await hub(env).fetch('https://hub/devices')).json<DeviceList>();
      const updates = await (await hub(env).fetch('https://hub/updates')).json<ReleaseDiscovery>();
      return {
        server_version: packageInfo.version,
        wire_protocol: WIRE_VERSION,
        updates: {
          ...updates,
          server_update_available: updateAvailable(updates, packageInfo.version),
        },
        service: await (
          await hub(env).fetch(env.PUBLIC_ORIGIN + '/setup/info')
        ).json<ServiceInfo>(),
        connections: result.devices
          .filter((x) => allowed.includes(x.deviceId))
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
        events: (
          await (
            await hub(env).fetch('https://hub/events', {
              method: 'POST',
              body: JSON.stringify({ auth: eventAuth, method: 'status' }),
            })
          ).json<{ ok: boolean; result?: object; error?: unknown }>()
        ).result ?? { delivery: 'webhook', diagnostic: 'EVENT_STORE_UNAVAILABLE' },
      };
    },
    invoke: async (operation, args) => {
      const response = await (
        await hub(env).fetch('https://hub/invoke', {
          method: 'POST',
          body: JSON.stringify({ operation, args, principal: 'owner', devices: allowed }),
        })
      ).json<Outcome<Record<string, unknown>>>();
      if (!response.ok)
        throw fail(response.error.code, response.error.message || response.error.code);
      return response.result;
    },
  });
}
