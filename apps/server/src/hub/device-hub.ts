import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import { serviceInfo } from '../env.ts';
import { Devices } from './devices.ts';
import { Agents, type GrantIdentity } from './agents.ts';
import { Sockets } from './sockets.ts';
import { Transactions } from '../oauth/transactions.ts';
import { Coordinator } from '../requests/service.ts';
import { Events } from '../events/subscriptions.ts';
import { eventAccess } from '../events/authorization.ts';
import { ReleaseUpdates } from '../updates/releases.ts';
import { requireAccess, grantIdentity, type Caller } from './access.ts';
import { enrollmentInput } from '@dotx/shared/http/enrollment';
import { agentInput } from '@dotx/shared/http/admin';
import type { AdminDevice } from '@dotx/shared/http/admin';
import type { Outcome } from '@dotx/shared/requests';
import { WIRE_VERSION } from '@dotx/shared/wire/version';
import type { GatewayOperation } from '../mcp/schemas.ts';
import { errorValue } from '@dotx/shared/errors';
import { HttpError, json, failure } from '../http/responses.ts';
import { readJson } from '../http/body.ts';
import { AdminSessions, type SessionRecord } from '../admin/sessions.ts';
import type { AuthRequest, ConsentDescription } from '@cloudflare/workers-oauth-provider';
export class DeviceHub extends DurableObject<Env> {
  readonly devices: Devices;
  readonly agents: Agents;
  readonly sockets: Sockets;
  readonly transactions: Transactions;
  readonly events: Events;
  readonly requests: Coordinator;
  readonly updates: ReleaseUpdates;
  readonly adminSessions: AdminSessions;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.adminSessions = new AdminSessions(ctx.storage, env);
    this.devices = new Devices(
      ctx.storage,
      env.PUBLIC_ORIGIN,
      serviceInfo(env).guides_url.replace('index.md', 'codex/connect.md'),
    );
    this.agents = new Agents(ctx.storage);
    this.transactions = new Transactions(ctx.storage, this.agents);
    this.sockets = new Sockets(ctx, env, this.devices, {
      observe: (id, data) => this.requests.turns.observe(id, data),
      recordReply: (id, value, source) => this.requests.records.recordReply(id, value, source),
    });
    this.events = new Events(ctx.storage, {
      waitUntil: (p) => ctx.waitUntil(p),
      authorized: async (auth, id) => {
        const identity = grantIdentity(auth);
        return (
          !!identity &&
          (await this.agents.active(identity)) &&
          (await this.devices.get(id))?.status === 'approved' &&
          eventAccess(env, auth, id)
        );
      },
      resolveTurn: (auth, args, inspect) =>
        this.requests.turns.eventTurn(
          { principal: auth.principal, devices: auth.devices },
          args,
          inspect,
        ),
    });
    this.requests = new Coordinator(
      ctx.storage,
      (principal, operation, args, id) =>
        this.sockets.dispatch(operation, args, id, () =>
          this.requests.records.assertActive(principal),
        ),
      this.events,
      (principal, tx) => this.agents.activePrincipal(principal, tx),
      env.RECORD_RETENTION_DAYS,
    );
    ctx.blockConcurrencyWhile(() => this.requests.records.retention.initialize());
    this.updates = new ReleaseUpdates(ctx.storage, env.RELEASE_REPOSITORY, env.RELEASE_CHANNEL);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url),
        path = url.pathname;
      if (path === '/device/connect') return await this.sockets.connect(request);
      if (path === '/setup/enroll' && request.method === 'POST') {
        const input = enrollmentInput.safeParse(await readJson(request));
        if (!input.success) throw new HttpError(400, 'INVALID_APPLICATION');
        return json(await this.devices.enroll(input.data));
      }
      if (path.startsWith('/internal/'))
        return json(await this.internal(path.slice(10), await request.json()));
      if (!path.startsWith('/admin/api/')) throw new HttpError(404, 'NOT_FOUND');
      if (path === '/admin/api/agents') {
        if (request.method === 'GET') return json({ agents: await this.agents.list() });
        if (request.method === 'POST') {
          const input = agentInput.safeParse(await readJson(request));
          if (!input.success) throw new HttpError(400, 'INVALID_AGENT_NAME');
          return json(
            {
              ...(await this.agents.issue(undefined, input.data.name)),
              mcp_url: this.env.PUBLIC_ORIGIN + '/mcp',
            },
            201,
          );
        }
      }
      const agent = /^\/admin\/api\/agents\/([^/]+)(?:\/(enrollment-code|revoke))?$/.exec(path);
      if (agent) {
        const [, id, action] = agent;
        if (!action && request.method === 'PATCH') {
          const input = agentInput.safeParse(await readJson(request));
          if (!input.success) throw new HttpError(400, 'INVALID_AGENT_NAME');
          return json(await this.agents.rename(id!, input.data.name));
        }
        if (action === 'enrollment-code' && request.method === 'POST')
          return json({
            ...(await this.agents.issue(id)),
            mcp_url: this.env.PUBLIC_ORIGIN + '/mcp',
          });
        if (action === 'enrollment-code' && request.method === 'DELETE')
          return json(await this.agents.cancel(id!));
        if (action === 'revoke' && request.method === 'POST')
          return json(await this.agents.revoke(id!));
      }
      if (path === '/admin/api/device-requests' && request.method === 'GET')
        return json({ requests: await this.devices.requests() });
      const decision = /^\/admin\/api\/device-requests\/([^/]+)\/(approve|reject)$/.exec(path);
      if (decision && request.method === 'POST') {
        const record = await this.devices.decide(decision[1]!, decision[2] as 'approve' | 'reject');
        await this.sockets.changed(record.device_id);
        return json(record);
      }
      if (path === '/admin/api/devices' && request.method === 'GET')
        return json({ devices: await this.adminDevices() });
      const revoke = /^\/admin\/api\/devices\/([^/]+)\/revoke$/.exec(path);
      if (revoke && request.method === 'POST') {
        await this.devices.revoke(revoke[1]!);
        await this.sockets.changed(revoke[1]!);
        return json((await this.adminDevices()).find((d) => d.device_id === revoke[1]));
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) {
      return failure(error);
    }
  }
  async internal(path: string, input: unknown): Promise<unknown> {
    const value = input as Record<string, any>;
    if (path === 'admin-session/create') {
      await this.adminSessions.create(value.id, value.record as SessionRecord);
      return null;
    }
    if (path === 'admin-session/read') return this.adminSessions.read(value.id);
    if (path === 'admin-session/current')
      return this.adminSessions.current(value.id, value.rejectedToken);
    if (path === 'admin-session/delete') {
      await this.adminSessions.delete(value.id);
      return null;
    }
    if (path === 'grants/bind')
      return this.agents.bind(value.identity as GrantIdentity, value.expires_at);
    if (path === 'grants/valid')
      return this.agents.valid(value.identity as GrantIdentity, value.activate === true);
    if (path === 'grants/ended')
      return [
        ...(
          await this.ctx.storage.list<{ userId: string; grantId: string }>({
            prefix: 'ended-grant:',
            limit: 50,
          })
        ).values(),
      ];
    if (path === 'grants/cleaned') {
      await this.ctx.storage.delete('ended-grant:' + value.userId + ':' + value.grantId);
      return null;
    }
    if (path === 'consent/create')
      return this.transactions.create(
        value.request as AuthRequest,
        value.description as ConsentDescription,
        value.binding,
      );
    if (path === 'consent/context') return this.transactions.context(value.id, value.binding);
    if (path === 'consent/reserve')
      return this.transactions.reserve(value.id, value.binding, value.code);
    if (path === 'consent/complete')
      return this.transactions.complete(value.id, value.binding, value.redirect);
    if (path === 'consent/cancel') return this.transactions.cancel(value.id, value.binding);
    if (path === 'consent/error') {
      await this.transactions.error(value.id, value.binding, value.error);
      return null;
    }
    throw new HttpError(404, 'NOT_FOUND');
  }
  async adminDevices(): Promise<AdminDevice[]> {
    const result: AdminDevice[] = [];
    for (const device of await this.devices.list()) {
      if (!device.approved_at) continue;
      const info = await this.sockets.info(device),
        wire = info.wireProtocol;
      result.push({
        device_id: device.device_id,
        name: device.name,
        key_id: device.key_id,
        public_key: device.public_key,
        status: device.status === 'revoked' ? 'revoked' : 'approved',
        approved_at: device.approved_at,
        last_seen: info.lastSeen,
        online: info.availability !== 'offline',
        compatible: wire === null ? null : wire === WIRE_VERSION,
        desktop_version: info.connectorVersion,
        wire_protocol: wire,
        server_wire_protocol: WIRE_VERSION,
        interfaces: info.interfaces ?? [],
        diagnostic: info.diagnostic,
      });
    }
    return result;
  }
  private async authority(caller: Caller) {
    const devices = (await this.devices.list())
      .filter((d) => d.status === 'approved')
      .map((d) => d.device_id);
    return { ...caller, devices };
  }
  async connectionSummary(auth: Caller) {
    await requireAccess(this.agents, auth);
    const devices = await Promise.all(
      (await this.devices.list())
        .filter((d) => d.status === 'approved')
        .map((d) => this.sockets.info(d)),
    );
    const updates = await this.updates.read();
    let events: Outcome<object>;
    try {
      events = {
        ok: true,
        result: await this.events.status({ ...auth, devices: devices.map((d) => d.deviceId) }),
      };
    } catch (error) {
      events = { ok: false, error: errorValue(error) };
    }
    await requireAccess(this.agents, auth);
    return {
      result: { devices, freshnessMs: 45_000 },
      updates,
      events,
      service: serviceInfo(this.env),
      record_retention_days: this.requests.records.retention.days,
    };
  }
  async eventRequest(auth: Caller, method: string, args: unknown): Promise<Outcome<object>> {
    try {
      await requireAccess(this.agents, auth);
      const result = await this.events.invoke(await this.authority(auth), method, args);
      await requireAccess(this.agents, auth);
      return { ok: true, result };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === -32015)
        return {
          ok: false,
          error: {
            code: -32015,
            message: 'CallbackEndpointError',
            data: 'data' in error ? error.data : undefined,
          },
        };
      return { ok: false, error: errorValue(error) };
    }
  }
  async invoke(
    auth: Caller,
    operation: GatewayOperation,
    args: unknown,
  ): Promise<Outcome<Record<string, unknown>>> {
    try {
      await requireAccess(this.agents, auth);
      const { devices } = await this.authority(auth);
      const result = await this.requests.invoke(
        { principal: auth.principal, devices },
        operation,
        args,
      );
      await requireAccess(this.agents, auth);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: errorValue(error) };
    }
  }
  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    await this.sockets.message(socket, data);
  }
  webSocketClose(socket: WebSocket) {
    this.sockets.close(socket);
  }
  webSocketError(socket: WebSocket) {
    this.sockets.close(socket);
  }
  async alarm() {
    await this.sockets.cleanup();
    await this.requests.records.retention.alarm();
    await this.events.alarm();
  }
}
