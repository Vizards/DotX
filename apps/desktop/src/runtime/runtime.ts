import { BridgeError, errorValue, errorCode } from '@dotx/shared/errors';
import fs from 'node:fs';
import type { DeviceConfig, ConnectionCredentials, InstanceStatus } from './config.ts';
import { readSchema } from '@dotx/shared/protocol';
import { WIRE_VERSION } from '@dotx/shared/gateway';
import type { DeviceOperation as Operation } from '@dotx/shared/state';
import { AppToolsAdapter } from '../interfaces/app-tools/adapter.ts';
import { AppServerAdapter } from '../interfaces/app-server/adapter.ts';
import { CoordinationAdapter } from '../interfaces/coordination/adapter.ts';
import type { Adapter } from '../interfaces/adapter.ts';
import type { Call } from '@dotx/shared/gateway';
import { Gateway } from '../gateway/dispatcher.ts';
import { EventBuffer } from '../events/buffer.ts';
import { Observations } from '../relay/observations.ts';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stateDir, privateDir, readJson } from './state.ts';
import { Native } from '../interfaces/app-tools/transport.ts';
import { resolveTurn } from '../tracking/attribution.ts';
import { TurnTracker } from '../tracking/tracker.ts';
import { discoverDesktop } from './desktop.ts';
import { validateConfig } from './config.ts';
import packageInfo from '../../package.json' with { type: 'json' };
import { DeviceConnection } from '../relay/connection.ts';

export function startDevice(closeStdio: () => Promise<void>) {
  process.umask(0o077);
  const desktopPid = process.ppid;
  const pipe = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  const dir = privateDir(stateDir()),
    config = readJson<DeviceConfig>(path.join(dir, 'config.json'));
  validateConfig(config);
  const instanceId = randomUUID(),
    native = new Native({
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
  const resolveAttribution = (task: import('../tracking/attribution.ts').TurnIdentity) =>
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
  async function execute(operation: Operation, args: unknown) {
    return gateway.execute(operation, args);
  }
  const instances = privateDir(path.join(dir, 'instances'));
  const statusFile = path.join(instances, `${instanceId}.json`);
  let status: InstanceStatus = {
    protocol: WIRE_VERSION,
    version: packageInfo.version,
    deviceId: config.deviceId,
    label: config.label,
    instanceId,
    pid: process.pid,
    startedAt: Date.now(),
    availability: 'unavailable',
    desktopVersion: desktop.version,
  };
  let stopped = false,
    probing = false;
  const save = () => {
    try {
      fs.writeFileSync(
        statusFile,
        JSON.stringify({ ...status, interfaces: gateway.statuses(), observedAt: Date.now() }),
        { mode: 0o600 },
      );
    } catch {
      // A best-effort status snapshot must not interrupt requests or cleanup.
    }
  };
  const connection = new DeviceConnection({
    credentials: () => {
      const file = path.join(dir, 'connection.json');
      return fs.existsSync(file) ? readJson<ConnectionCredentials>(file) : null;
    },
    deviceId: config.deviceId,
    observations,
    execute,
    heartbeat: () => ({
      availability: status.availability,
      desktopVersion: status.desktopVersion,
      connectorVersion: packageInfo.version,
      instanceId,
      interfaces: gateway.statuses().map(({ diagnostic: _diagnostic, ...presence }) => presence),
    }),
    diagnostic: (relayDiagnostic) => {
      status = { ...status, relayDiagnostic };
      save();
    },
  });
  async function probe() {
    if (probing) return;
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
      save();
      // The connection owns the periodic heartbeat. Publish only health transitions here.
      if (`${status.availability}:${errorCode(status.diagnostic) ?? ''}` !== previousHealth)
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
    clearInterval(ownerInterval);
    connection.stop();
    await closeStdio();
    events.expireRuntime(appTools.status().runtime_id);
    coordination.close();
    await appServer.close();
    try {
      fs.unlinkSync(statusFile);
    } catch {}
    process.exit(0);
  }
  function stdioClosed() {
    // A desktop discovery client may close stdio while the desktop itself stays alive.
    // Keep this original child and its trusted ancestry; never detach or orphan a worker.
    if (!pipe) return stop('stdio-closed-no-pipe');
    status.stdioClosed = true;
    save();
  }
  process.stdin.once('end', stdioClosed);
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  const ownerInterval = setInterval(() => {
    if (process.ppid !== desktopPid) stop('parent-changed');
    else if (pipe && !fs.existsSync(pipe)) stop('desktop-pipe-removed');
  }, 1000);
  const interval = setInterval(probe, 15000);
  save();
  void probe();
  connection.start();

  return { status: () => ({ ...status, interfaces: gateway.statuses() }) };
}
