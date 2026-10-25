import { Buffer } from 'node:buffer';
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
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
