import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
export const randomSecret = (bytes = 32) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
export const sha256 = async (input: string | Uint8Array) =>
  Buffer.from(
    await crypto.subtle.digest(
      'SHA-256',
      typeof input === 'string'
        ? new TextEncoder().encode(input)
        : (input as Uint8Array<ArrayBuffer>),
    ),
  ).toString('base64url');
export function sameSecret(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
