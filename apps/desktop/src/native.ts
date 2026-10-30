import { BridgeError, errorValue, errorCode } from '@dotx/shared/errors';
import type { ReadyConfig } from './local/config.ts';
import type { InstanceStatus } from './local/status.ts';
import type { Identity } from './local/identity.ts';
import { readSchema } from './interfaces/app-tools/schema.ts';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import { AppToolsAdapter } from './interfaces/app-tools/adapter.ts';
import { AppServerAdapter } from './interfaces/app-server/adapter.ts';
import { CoordinationAdapter } from './interfaces/coordination/adapter.ts';
import type { Adapter } from './interfaces/adapter.ts';
import type { Call } from '@dotx/shared/wire/commands';
import { Gateway } from './gateway/dispatcher.ts';
import { EventBuffer } from './events/buffer.ts';
import { Observations } from './connection/observations.ts';
import path from 'node:path';
import { privateDir } from './local/files.ts';
import { Native } from './interfaces/app-tools/transport.ts';
import { resolveTurn } from './tracking/attribution.ts';
import { TurnTracker } from './tracking/tracker.ts';
import { discoverDesktop } from './interfaces/host.ts';
import { validateConfig } from './local/config.ts';
import packageInfo from '../package.json' with { type: 'json' };
import { DeviceConnection } from './connection/socket.ts';

export function startDevice(
  dir: string,
  config: ReadyConfig,
  identity: Identity,
  generation: number,
) {
  process.umask(0o077);
  validateConfig(config);
  const native = new Native({
    pipe: process.env.CODEX_APP_TOOLS_PIPE_PATH,
    callerThreadId: config.callerThreadId,
  });
  const observations = new Observations();
  const events = new EventBuffer((e) => observations.native(e));
  const desktop = discoverDesktop();
  const appTools = new AppToolsAdapter({ native, version: desktop.version });
  events.registerRuntime(appTools.status().runtime_id);
  function createAppServer() {
    const adapter = new AppServerAdapter({
      cli: desktop.cli,
      home: config.codexHome,
      cwd: privateDir(path.join(dir, 'runtime-workspace')),
      version: desktop.version,
      onEvent: (event, responseSchema) => {
        if (event.method === 'serverRequest/resolved')
          events.resolveServerRequest(
            adapter.runtimeId,
            (event.params as Record<string, unknown>)?.requestId,
          );
        events.addEvent({
          connection_id: config.deviceId,
          interface: 'app_server',
          runtime_id: adapter.runtimeId,
          kind: event.id !== undefined ? 'server_request' : 'notification',
          native: event,
          response_schema: responseSchema,
          ...(event.id !== undefined ? { response_status: 'pending' as const } : {}),
        });
      },
      onExit: (runtime) => {
        events.expireRuntime(runtime);
        events.addEvent({
          connection_id: config.deviceId,
          interface: 'app_server',
          runtime_id: runtime,
          kind: 'lifecycle',
          native: { method: 'runtime/ended' },
        });
      },
    });
    events.registerRuntime(adapter.runtimeId);
    return adapter;
  }
  let appServer = createAppServer();
  const resolveAttribution = (task: import('./tracking/attribution.ts').TurnIdentity) =>
    resolveTurn(task, (method, params) => appServer.call(method, params));
  let tracker: TurnTracker;
  const coordination = new CoordinationAdapter({
    home: config.codexHome,
    version: desktop.version,
    connectionId: config.deviceId,
    events,
    nativeCatalog: appServer.catalog,
    onState: (target) => {
      void tracker?.changed(target);
    },
  });
  tracker = new TurnTracker(
    native,
    config.callerThreadId,
    (o) => observations.turn(o),
    resolveAttribution,
    coordination,
  );
  const gateway = new Gateway({
    connectionId: config.deviceId,
    events,
    tracker,
    resolveTurn: resolveAttribution,
    adapters: new Map<Call['interface'], Adapter>([
      ['app_tools', appTools],
      ['app_server', appServer],
      ['client_coordination', coordination],
    ]),
  });
  let status: InstanceStatus = {
    protocol: WIRE_VERSION,
    version: packageInfo.version,
    deviceId: config.deviceId,
    label: config.label,
    pid: process.pid,
    startedAt: Date.now(),
    availability: 'unavailable',
    desktopVersion: desktop.version,
  };
  let stopped = false,
    probing = false;
  const connection = new DeviceConnection({
    config,
    identity,
    generation,
    observations,
    execute: (operation, args) => gateway.execute(operation, args),
    heartbeat: () => ({
      availability: status.availability,
      desktopVersion: status.desktopVersion,
      interfaces: gateway.statuses().map(({ diagnostic: _diagnostic, ...presence }) => presence),
    }),
    diagnostic: (relayDiagnostic) => {
      status = { ...status, relayDiagnostic };
    },
  });
  async function probe() {
    if (probing || stopped) return;
    probing = true;
    if (appServer.ended) {
      appServer = createAppServer();
      gateway.adapters.set('app_server', appServer);
    }
    const previousHealth = `${status.availability}:${errorCode(status.diagnostic) ?? ''}`;
    try {
      // Probe the real caller, independently of method discovery.
      const response = readSchema.parse(
        await native.call('read_thread', {
          threadId: config.callerThreadId,
          hostId: 'local',
          turnLimit: 1,
          includeOutputs: false,
        }),
      );
      if (
        response.thread.id !== config.callerThreadId ||
        response.thread.kind !== 'codex' ||
        response.thread.hostId !== 'local'
      )
        throw new BridgeError('CALLER_IDENTITY_MISMATCH');
      appTools.ready = true;
      status = {
        ...status,
        availability: 'online',
        diagnostic: null,
      };
    } catch (e) {
      appTools.ready = false;
      status = {
        ...status,
        availability: [appServer, coordination].some((a) => a.status().availability === 'online')
          ? 'online'
          : 'unavailable',
        diagnostic: errorValue(e),
      };
    } finally {
      probing = false;
      // The connection owns the periodic heartbeat. Publish only health transitions here.
      if (
        !stopped &&
        `${status.availability}:${errorCode(status.diagnostic) ?? ''}` !== previousHealth
      )
        connection.sendHeartbeat();
    }
  }
  async function stop(reason = 'signal') {
    if (stopped) return;
    stopped = true;
    try {
      process.stderr.write(JSON.stringify({ code: 'CONNECTOR_STOPPED', reason }) + '\n');
    } catch {}
    clearInterval(interval);
    connection.stop();
    events.expireRuntime(appTools.status().runtime_id);
    coordination.close();
    await appServer.close();
  }
  const interval = setInterval(probe, 15000);
  void probe();
  connection.start();

  return {
    stop,
    status: () => ({
      ...status,
      target_server: config.service.origin,
      service_id: config.service.service_id,
      key_id: config.keyId,
      connection: connection.status(),
      interfaces: gateway.statuses(),
    }),
  };
}
