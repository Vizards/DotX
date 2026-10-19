export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message = code, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
// Marks a native failure when an internal caller needs to throw rather than return it.
// This carrier is never part of the wire response.
export class NativeError extends Error {
  readonly value: unknown;
  constructor(value: unknown) {
    super('Native call failed');
    this.value = value;
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
export function errorValue(error: unknown): unknown {
  if (error instanceof NativeError) return error.value;
  // Error.message is non-enumerable. Native JSON values already need no conversion.
  if (error instanceof Error)
    return {
      // Node's execFileSync error can contain error.error === error. This alias
      // carries no extra evidence and would make the diagnostic unserializable.
      ...Object.fromEntries(Object.entries(error).filter(([, value]) => value !== error)),
      name: error.name,
      message: error.message,
      ...(error.cause === undefined || error.cause === error
        ? {}
        : { cause: errorValue(error.cause) }),
    };
  return error;
}
