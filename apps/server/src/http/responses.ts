export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message = code, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export function json(value: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set('Cache-Control', 'no-store');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Content-Type-Options', 'nosniff');
  return Response.json(value, { status, headers: h });
}
export function failure(error: unknown) {
  return error instanceof HttpError
    ? json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.status,
      )
    : json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message:
              'The request could not be completed. Read the current state before retrying a write.',
          },
        },
        500,
      );
}
