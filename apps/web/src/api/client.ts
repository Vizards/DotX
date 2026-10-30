import type { HttpFailure } from '@dotx/shared/http/admin';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly path: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, path: string, details?: unknown) {
    super(message);
    this.path = path;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    csrf?: string | null;
    setup?: string;
    claim?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined
        ? {}
        : {
            'Content-Type':
              options.body instanceof URLSearchParams
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
          }),
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
      ...(options.setup ? { 'X-DotX-Setup': options.setup } : {}),
      ...(options.claim ? { 'X-DotX-Claim': '1' } : {}),
    },
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof URLSearchParams
          ? options.body.toString()
          : JSON.stringify(options.body),
  });
  const body: T | HttpFailure | null = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as HttpFailure | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Request failed (${response.status})`,
      path,
      error?.details,
    );
  }
  if (body === null)
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unreadable response. Refresh state before retrying an operation.',
      path,
    );
  return body as T;
}
