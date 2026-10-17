import type { Diagnostic } from './protocol.ts';
export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}
export function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
export const safeError = (error: unknown): Diagnostic => ({
  code: errorCode(error) || 'INTERNAL_ERROR',
  message: error instanceof BridgeError ? error.message : 'See machine-local diagnostics',
});
