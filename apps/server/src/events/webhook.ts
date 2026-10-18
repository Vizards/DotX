import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import packageInfo from '../../package.json' with { type: 'json' };
export class CallbackError extends Error {
  readonly code = -32015;
  readonly data: { reason: string; attempt?: CallbackAttempt };
  constructor(reason: string, attempt?: CallbackAttempt) {
    super('CallbackEndpointError');
    this.data = { reason, ...(attempt ? { attempt } : {}) };
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
const digest = async (value: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString(
    'hex',
  );
export function responseHeaders(response: Response) {
  const token = (value: string | null) =>
    value && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const date = Date.parse(response.headers.get('date') ?? '');
  const retry = response.headers.get('retry-after');
  const now = Date.now();
  // Use the scheduler's date range rather than an arbitrary number of digits.
  const retryAt =
    retry && /^\d+$/.test(retry)
      ? new Date(now + Number(retry) * 1000).getTime()
      : retry?.endsWith('GMT')
        ? Date.parse(retry)
        : NaN;
  return {
    date: Number.isFinite(date) ? new Date(date).toISOString() : undefined,
    clock_skew_ms: Number.isFinite(date) ? date - now : undefined,
    retry_after_seconds: Number.isFinite(retryAt)
      ? Math.max(0, Math.ceil((retryAt - now) / 1000))
      : undefined,
    content_type:
      contentType === 'text/html' || contentType === 'application/json' ? contentType : 'other',
    request_id: token(response.headers.get('x-request-id')),
    edge_id: token(response.headers.get('cf-ray')),
    server: token(response.headers.get('server')),
    edge_mitigated: token(response.headers.get('cf-mitigated')),
    edge_error_type: token(response.headers.get('cf-error-type')),
    edge_error_origin: token(response.headers.get('cf-error-origin')),
  };
}
export interface CallbackAttempt {
  phase: 'verification' | 'event';
  webhook_id: string;
  started_at: string;
  duration_ms: number;
  callback_origin: string;
  callback_sha256: string;
  request_bytes: number;
  request_sha256: string;
  http_status: number;
  signed_at?: string;
  signature_count?: number;
  signing_delay_ms?: number;
  alarm_id?: string;
  alarm_ordinal?: number;
  attempt_number?: number;
  event_age_ms?: number;
  verification_age_ms?: number;
  outcome?: 'accepted' | 'retry_scheduled' | 'retries_exhausted' | 'permanent_failure';
  retry_at?: string;
  transport_error?: 'timeout' | 'network';
  response?: ReturnType<typeof responseHeaders> & {
    category?: string;
    edge_error_code?: string;
    body_signals?: string[];
    body_prefix_sha256?: string;
    body_prefix_bytes?: number;
    reported_client_ip?: { family: number; kind: 'workers_cross_zone' | 'other' };
  };
}
export async function beginAttempt(
  url: string,
  id: string,
  body: string,
  phase: CallbackAttempt['phase'],
): Promise<CallbackAttempt> {
  return {
    phase,
    webhook_id: id,
    started_at: new Date().toISOString(),
    duration_ms: 0,
    callback_origin: new URL(url).origin,
    callback_sha256: await digest(url),
    request_bytes: Buffer.byteLength(body),
    request_sha256: await digest(body),
    http_status: 0,
  };
}
export function transportError(error: unknown): 'timeout' | 'network' {
  return error instanceof Error && /timeout|abort/i.test(error.name) ? 'timeout' : 'network';
}
// Retain bounded, non-content diagnostics. Callback bodies may contain secrets
// or user data, so never persist or return their raw text.
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
      /* Headers and HTTP status remain useful when the body cannot be read. */
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
  else if (/signature/i.test(text)) category = 'signature_rejected';
  else if (/subscription/i.test(text)) category = 'subscription_rejected';
  else if (/token|unauthorized|authentication/i.test(text)) category = 'authentication_rejected';
  else if (/schema|payload|validation/i.test(text)) category = 'payload_rejected';
  else if (/forbidden|permission/i.test(text)) category = 'forbidden';
  // Cloudflare's own block page sometimes identifies the address it evaluated.
  // Keep only its family and shared Workers classification, never an address or IP digest.
  const reported = text.match(/id=["']cf-footer-ip["'][^>]*>\s*([a-fA-F0-9:.]+)\s*</)?.[1];
  const family = reported ? isIP(reported) : 0;
  return {
    ...headers,
    category,
    body_prefix_sha256: await digest(text),
    body_prefix_bytes: Buffer.byteLength(text),
    reported_client_ip:
      reported && family
        ? {
            family,
            kind:
              reported.toLowerCase() === '2a06:98c0:3600::103'
                ? ('workers_cross_zone' as const)
                : ('other' as const),
          }
        : undefined,
    edge_error_code:
      category === 'edge_denied'
        ? text.replace(/<[^>]*>/g, ' ').match(/(?:error(?:\s+code)?[\s:]+)(\d{3,5})\b/i)?.[1]
        : undefined,
    // Fixed labels only: no page text, IPs, callback paths, or arbitrary error strings.
    body_signals: [
      [/cloudflare/i, 'cloudflare'],
      [/sorry,? you have been blocked/i, 'blocked_page'],
      [/attention required/i, 'attention_required'],
      [/cf-chl-|Just a moment/i, 'challenge_page'],
      [/unsupported_country_region_territory|country.{0,30}not supported/i, 'unsupported_region'],
    ]
      .filter(([pattern]) => (pattern as RegExp).test(text))
      .map(([, label]) => label as string),
  };
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
  attempt?: CallbackAttempt,
) {
  if (new TextEncoder().encode(body).length > 262144) throw new CallbackError('payload_too_large');
  const signedAt = Date.now();
  const timestamp = String(Math.floor(signedAt / 1000));
  const signatures = [await sign(sub.secret, id, timestamp, body)];
  if (sub.oldSecret && (sub.oldUntil ?? 0) > Date.now())
    signatures.push(await sign(sub.oldSecret, id, timestamp, body));
  if (attempt) {
    attempt.signed_at = new Date(Number(timestamp) * 1000).toISOString();
    attempt.signature_count = signatures.length;
    attempt.signing_delay_ms = Date.now() - signedAt;
  }
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
  const attempt = await beginAttempt(sub.url, id, body, 'verification');
  const started = Date.now();
  try {
    const response = await postSigned(transport, sub, id, body, attempt);
    attempt.http_status = response.status;
    attempt.response = { ...responseHeaders(response), category: 'http_success' };
    if (!response.ok) {
      attempt.response = await responseDiagnostic(response);
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
    attempt.duration_ms = Date.now() - started;
    attempt.response.category = 'challenge_verified';
    return attempt;
  } catch (e) {
    attempt.duration_ms = Date.now() - started;
    if (!attempt.http_status) attempt.transport_error = transportError(e);
    if (e instanceof CallbackError) throw new CallbackError(e.data.reason, attempt);
    throw new CallbackError(
      transportError(e) === 'timeout' ? 'timeout' : 'challenge_failed',
      attempt,
    );
  }
}
