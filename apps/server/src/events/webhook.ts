import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import packageInfo from '../../package.json' with { type: 'json' };
export class CallbackError extends Error {
  readonly code = -32015;
  readonly data: { reason: string } & Partial<CallbackDiagnostic>;
  constructor(reason: string, diagnostic: Partial<CallbackDiagnostic> = {}) {
    super('CallbackEndpointError');
    this.data = { reason, ...diagnostic };
  }
}
export function callbackURL(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CallbackError('invalid_url');
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    isIP(hostname) ||
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan)$/.test(hostname)
  )
    throw new CallbackError('non_public_destination');
  return url.href;
}
export function secretBytes(secret: string) {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new CallbackError('invalid_secret');
  const bytes = Buffer.from(secret.slice(6), 'base64');
  if (
    bytes.length < 24 ||
    bytes.length > 64 ||
    bytes.toString('base64').replace(/=+$/, '') !== secret.slice(6).replace(/=+$/, '')
  )
    throw new CallbackError('invalid_secret');
  return bytes;
}
export async function sign(secret: string, id: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${Buffer.from(signature).toString('base64')}`;
}
export type WebhookFetch = (url: string, init: RequestInit) => Promise<Response>;
function responseHeaders(response: Response) {
  const token = (value: string | null) =>
    value && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
  const retry = response.headers.get('retry-after');
  const now = Date.now();
  const retryAt =
    retry && /^\d+$/.test(retry)
      ? new Date(now + Number(retry) * 1000).getTime()
      : retry?.endsWith('GMT')
        ? Date.parse(retry)
        : NaN;
  return {
    retry_after_seconds: Number.isFinite(retryAt)
      ? Math.max(0, Math.ceil((retryAt - now) / 1000))
      : undefined,
    content_type: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),
    request_id: token(response.headers.get('x-request-id')),
    edge_id: token(response.headers.get('cf-ray')),
  };
}
interface CallbackDiagnostic {
  http_status: number;
  transport_error?: 'timeout' | 'network';
  response?: Awaited<ReturnType<typeof responseDiagnostic>>;
}
export function transportError(error: unknown): 'timeout' | 'network' {
  return error instanceof Error && /timeout|abort/i.test(error.name) ? 'timeout' : 'network';
}
// Read only enough to distinguish the edge denial covered by the retry policy.
// Do not retain response bodies or fingerprints in diagnostics.
export async function responseDiagnostic(response: Response) {
  const headers = responseHeaders(response);
  let category = 'http_error';
  let text = '';
  const reader = response.body?.getReader();
  if (reader) {
    try {
      let bytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        text += new TextDecoder().decode(part.value.subarray(0, Math.max(0, 8192 - bytes)));
        bytes += part.value.length;
        if (bytes >= 8192) break;
      }
    } catch {
      // Status and headers still locate the failure when the body is unavailable.
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  if (response.headers.get('cf-mitigated') === 'challenge' || /cf-chl-|Just a moment/i.test(text))
    category = 'edge_challenge';
  else if (
    /cloudflare|error code: 1020|access denied/i.test(text) &&
    headers.content_type === 'text/html'
  )
    category = 'edge_denied';
  return { ...headers, category };
}
// Must run in Workers with global_fetch_strictly_public and the default public
// outbound network. The runtime resolves/connects under its public-IP filter,
// retains HTTPS hostname verification, and blocks private resolutions. A separate
// application DNS lookup followed by fetch would introduce a rebinding race.
// Never replace this with a private origin binding or unrestricted local fetch.
// This transport owns the HTTP timeout for both verification and event delivery.
export const webhookFetch: WebhookFetch = async (url, init) =>
  fetch(callbackURL(url), {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
export async function postSigned(
  transport: WebhookFetch,
  sub: { id: string; url: string; secret: string; oldSecret?: string; oldUntil?: number },
  id: string,
  body: string,
) {
  if (new TextEncoder().encode(body).length > 262144) throw new CallbackError('payload_too_large');
  const signedAt = Date.now();
  const timestamp = String(Math.floor(signedAt / 1000));
  const signatures = [await sign(sub.secret, id, timestamp, body)];
  if (sub.oldSecret && (sub.oldUntil ?? 0) > Date.now())
    signatures.push(await sign(sub.oldSecret, id, timestamp, body));
  return transport(callbackURL(sub.url), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `dotx-server/${packageInfo.version}`,
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signatures.join(' '),
      'X-MCP-Subscription-Id': sub.id,
    },
    body,
  });
}
export async function verifyCallback(
  transport: WebhookFetch,
  sub: { id: string; url: string; secret: string },
) {
  const challenge = crypto.randomUUID() + crypto.randomUUID();
  const id = `verify_${crypto.randomUUID()}`;
  const body = JSON.stringify({ type: 'verification', challenge });
  const diagnostic: CallbackDiagnostic = { http_status: 0 };
  try {
    const response = await postSigned(transport, sub, id, body);
    diagnostic.http_status = response.status;
    diagnostic.response = { ...responseHeaders(response), category: 'http_success' };
    if (!response.ok) {
      diagnostic.response = await responseDiagnostic(response);
      throw new CallbackError('challenge_failed');
    }
    const reader = response.body?.getReader();
    let text = '';
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
          if (text.length > 1024) throw new CallbackError('challenge_failed');
        }
      } finally {
        await reader.cancel();
      }
    }
    const echoed: unknown = JSON.parse(text).challenge;
    if (
      typeof echoed !== 'string' ||
      Buffer.byteLength(echoed) !== Buffer.byteLength(challenge) ||
      !timingSafeEqual(Buffer.from(echoed), Buffer.from(challenge))
    )
      throw new CallbackError('challenge_failed');
  } catch (e) {
    if (!diagnostic.http_status) diagnostic.transport_error = transportError(e);
    if (e instanceof CallbackError) throw new CallbackError(e.data.reason, diagnostic);
    throw new CallbackError(
      transportError(e) === 'timeout' ? 'timeout' : 'challenge_failed',
      diagnostic,
    );
  }
}
