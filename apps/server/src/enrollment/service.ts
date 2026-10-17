import { z } from 'zod';
import { sha256 } from '../auth/credentials.ts';
import type { AtomicStore, Store } from '../hub/storage.ts';
import type { RegisteredDevice } from '@dotx/shared/protocol';
import type { ServiceInfo } from '@dotx/shared/service';

export const secret = () => crypto.randomUUID() + crypto.randomUUID();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
export const enrollmentInput = z.strictObject({
  operation_id: uuid,
  device_id: uuid,
  label: z.string().trim().min(1).max(100),
  token_hash: hash,
  claim_hash: hash,
});
type EnrollmentInput = z.infer<typeof enrollmentInput>;
type Pending = EnrollmentInput & { expires: number; approved: boolean };
const registryKey = 'setup:devices';
const pendingKey = 'setup:pending';
const cookieName = '__Host-dotx-admin';
const deny = (code: string) => Object.assign(new Error(code), { code });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
function html(body: string, headers: HeadersInit = {}) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DotX Setup</title><style>body{font:17px system-ui;max-width:640px;margin:8vh auto;padding:24px;line-height:1.7}button{font:inherit;padding:10px 24px}code{overflow-wrap:anywhere}</style><h1>DotX</h1>${body}</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // A no-referrer document makes native form POST Origin=null in browsers.
        // Preserve same-origin form provenance without sending referrers off-site.
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
        ...headers,
      },
    },
  );
}

// One singleton DO owns the registry and approval transitions. Device credentials
// never authorize administration; the newly joining Mac retains its private token.
export class Enrollment {
  readonly store: AtomicStore;
  readonly ownerHash: string;
  readonly origin: string;
  constructor(store: AtomicStore, ownerHash: string, origin: string) {
    this.store = store;
    this.ownerHash = ownerHash;
    this.origin = origin;
  }
  async devices(store: Store = this.store) {
    return (await store.get<RegisteredDevice[]>(registryKey)) ?? [];
  }
  async info(): Promise<ServiceInfo> {
    return {
      product: 'dotx',
      setup_protocol: 1,
      origin: this.origin,
    };
  }
  async owner(request: Request) {
    const value = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    return !!value && !!this.ownerHash && (await sha256(value)) === this.ownerHash;
  }
  async browser(request: Request) {
    const value = request.headers
      .get('Cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    if (!value) return false;
    const session = await this.store.get<{ expires: number; ownerHash: string }>(
      'setup:session:' + (await sha256(value)),
    );
    return !!session && session.expires > Date.now() && session.ownerHash === this.ownerHash;
  }
  async admin(request: Request) {
    return (
      (await this.owner(request)) ||
      (request.headers.get('Origin') === this.origin && (await this.browser(request)))
    );
  }
  async request(input: unknown) {
    const value = enrollmentInput.parse(input);
    return this.store.transaction(async (tx) => {
      const pending = (await tx.get<Pending[]>(pendingKey)) ?? [];
      const existing = pending.find((p) => p.operation_id === value.operation_id);
      if (existing) {
        if (Object.entries(value).some(([k, v]) => existing[k as keyof EnrollmentInput] !== v))
          throw deny('ENROLLMENT_CONFLICT');
        if (existing.expires <= Date.now()) throw deny('ENROLLMENT_EXPIRED');
        return {
          operation_id: existing.operation_id,
          expires: existing.expires,
          approved: existing.approved,
        };
      }
      const live = pending.filter((p) => p.expires > Date.now());
      if (live.length >= 64) throw deny('ENROLLMENT_CAPACITY');
      const device = (await this.devices(tx)).find((d) => d.id === value.device_id);
      if (device && (device.tokenHash !== value.token_hash || device.label !== value.label))
        throw deny('DEVICE_ID_CONFLICT');
      const row = { ...value, expires: Date.now() + 15 * 60_000, approved: !!device };
      await tx.put(pendingKey, [...live, row]);
      return { operation_id: row.operation_id, expires: row.expires, approved: row.approved };
    });
  }
  async approve(id: string) {
    uuid.parse(id);
    return this.store.transaction(async (tx) => {
      const rows = (await tx.get<Pending[]>(pendingKey)) ?? [];
      const row = rows.find((p) => p.operation_id === id);
      if (!row || row.expires <= Date.now()) throw deny('ENROLLMENT_EXPIRED');
      const devices = await this.devices(tx);
      const existing = devices.find((d) => d.id === row.device_id);
      if (existing && (existing.tokenHash !== row.token_hash || existing.label !== row.label))
        throw deny('DEVICE_ID_CONFLICT');
      if (!existing) {
        if (devices.length >= 32) throw deny('DEVICE_CAPACITY');
        devices.push({ id: row.device_id, label: row.label, tokenHash: row.token_hash });
        await tx.put(registryKey, devices);
      }
      row.approved = true;
      await tx.put(pendingKey, rows);
      return { approved: true, device_id: row.device_id };
    });
  }
  async status(id: string, token: string) {
    uuid.parse(id);
    const row = ((await this.store.get<Pending[]>(pendingKey)) ?? []).find(
      (p) => p.operation_id === id,
    );
    if (!row || (await sha256(token)) !== row.claim_hash) throw deny('ENROLLMENT_NOT_FOUND');
    // An approved identity is durable even if the installer missed its response.
    const device = (await this.devices()).find(
      (d) => d.id === row.device_id && d.tokenHash === row.token_hash,
    );
    if (row.approved && device) return { approved: true, device_id: row.device_id };
    if (row.expires <= Date.now()) throw deny('ENROLLMENT_EXPIRED');
    return { approved: false, expires: row.expires };
  }
  async revoke(id: string) {
    uuid.parse(id);
    await this.store.transaction(async (tx) => {
      await tx.put(
        registryKey,
        (await this.devices(tx)).filter((d) => d.id !== id),
      );
      const pending = (await tx.get<Pending[]>(pendingKey)) ?? [];
      await tx.put(
        pendingKey,
        pending.filter((p) => p.device_id !== id),
      );
    });
    return { revoked: true, device_id: id };
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
    try {
      if (request.method === 'POST') {
        const origin = request.headers.get('Origin');
        if (origin && origin !== this.origin) return json({ error: 'BAD_ORIGIN' }, 403);
        if (Number(request.headers.get('Content-Length') ?? 0) > 8192)
          return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
      }
      if (url.pathname === '/setup/browser-status' && request.method === 'GET')
        return json({ admin: await this.browser(request) });
      if (url.pathname === '/setup/info' && request.method === 'GET')
        return json(await this.info());
      if (url.pathname === '/setup/revoke' && request.method === 'POST') {
        if (!(await this.owner(request))) return json({ error: 'OWNER_REQUIRED' }, 401);
        const { device_id } = z.strictObject({ device_id: uuid }).parse(await request.json());
        return json(await this.revoke(device_id));
      }
      if (url.pathname === '/setup/browser' && request.method === 'POST') {
        if (!(await this.owner(request))) return json({ error: 'OWNER_REQUIRED' }, 401);
        const ticket = secret();
        // At most one outstanding ticket; retry can issue another, never reuses a consumed one.
        await this.store.put('setup:ticket', {
          hash: await sha256(ticket),
          expires: Date.now() + 120_000,
        });
        return json({ url: `${this.origin}/setup/session?ticket=${encodeURIComponent(ticket)}` });
      }
      if (url.pathname === '/setup/session' && request.method === 'GET') {
        const ticketHash = await sha256(url.searchParams.get('ticket') ?? '');
        const session = secret(),
          sessionHash = await sha256(session);
        await this.store.transaction(async (tx) => {
          const ticket = await tx.get<{ hash: string; expires: number }>('setup:ticket');
          if (!ticket || ticket.hash !== ticketHash || ticket.expires <= Date.now())
            throw deny('LOGIN_LINK_EXPIRED');
          await tx.put('setup:ticket', { hash: '', expires: 0 });
          // Single browser admin session, renewed explicitly by the deployment owner.
          const old = await tx.get<string>('setup:current-session');
          if (old) await tx.put('setup:session:' + old, { expires: 0, ownerHash: '' });
          await tx.put('setup:current-session', sessionHash);
          await tx.put('setup:session:' + sessionHash, {
            expires: Date.now() + 3600_000,
            ownerHash: this.ownerHash,
          });
        });
        return new Response(null, {
          status: 303,
          headers: {
            Location: '/setup',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Set-Cookie': `${cookieName}=${session}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
          },
        });
      }
      if (url.pathname === '/setup' && request.method === 'GET') {
        if (!(await this.browser(request)))
          return html(
            '<p>An administrator session is required. The setup assistant can run <code>setup.mjs admin-link</code> on the Mac holding the owner credentials and open the returned link in this browser session. Device credentials cannot enroll other devices.</p>',
          );
        return html(
          `<p>The administrator session is ready. Continue ChatGPT OAuth authorization or approve another Mac’s pairing request.</p><p>Service: <code>${esc(this.origin)}</code></p><p>Registered devices: ${(await this.devices()).map((d) => esc(d.label)).join(', ') || 'None'}</p>`,
        );
      }
      if (url.pathname === '/setup/enroll' && request.method === 'POST') {
        const body = await request.text();
        if (body.length > 8192) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
        return json(await this.request(JSON.parse(body)));
      }
      if (url.pathname === '/setup/enroll/status' && request.method === 'POST') {
        const body = z.strictObject({ operation_id: uuid }).parse(await request.json());
        return json(await this.status(body.operation_id, bearer));
      }
      if (url.pathname === '/setup/approve' && request.method === 'POST') {
        if (!(await this.admin(request))) return json({ error: 'OWNER_REQUIRED' }, 401);
        const form = request.headers
          .get('Content-Type')
          ?.includes('application/x-www-form-urlencoded');
        const input = form ? Object.fromEntries(await request.formData()) : await request.json();
        const { operation_id } = z.strictObject({ operation_id: uuid }).parse(input);
        const result = await this.approve(operation_id);
        return form
          ? html('<p>Device enrollment approved. Continue setup on the new Mac.</p>')
          : json(result);
      }
      if (url.pathname.startsWith('/setup/pair/') && request.method === 'GET') {
        if (!(await this.browser(request)))
          return html(
            '<p>An administrator session is required. The setup assistant can run <code>setup.mjs admin-link</code> on the Mac holding the owner credentials, open the returned link in this browser session, then return to this pairing page.</p>',
          );
        const id = uuid.parse(url.pathname.slice('/setup/pair/'.length));
        const row = ((await this.store.get<Pending[]>(pendingKey)) ?? []).find(
          (p) => p.operation_id === id,
        );
        if (!row || row.expires <= Date.now()) throw deny('ENROLLMENT_EXPIRED');
        return html(
          `<h2>Enroll ${esc(row.label)}</h2><p>Verify the fingerprint shown on the new Mac: <code>${esc(row.token_hash.slice(0, 16))}</code></p><p>Approval adds this device to the service and lets authorized ChatGPT/dot connections access its exposed Codex capabilities.</p><form method="post" action="/setup/approve"><input type="hidden" name="operation_id" value="${id}"><button>Approve this device</button></form>`,
        );
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const code =
        error instanceof z.ZodError
          ? 'INVALID_SETUP_INPUT'
          : error instanceof Error && 'code' in error
            ? String(error.code)
            : 'SETUP_FAILED';
      return json({ error: code }, 400);
    }
  }
}
