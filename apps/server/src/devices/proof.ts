import { Buffer } from 'node:buffer';
import type { DevicePublicKey } from '@dotx/shared/http/enrollment';
import { sha256 } from '../http/crypto.ts';
export async function keyId(publicKey: DevicePublicKey) {
  const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, true, [
    'verify',
  ]);
  return sha256(new Uint8Array((await crypto.subtle.exportKey('spki', key)) as ArrayBuffer));
}
export async function verifyProof(
  jws: string,
  challenge: string,
  publicKey: DevicePublicKey,
  fingerprint: string,
) {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
    const [protectedPart, payload, signature] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(protectedPart, 'base64url').toString('utf8'));
    if (
      Object.keys(header).sort().join(',') !== 'alg,kid,typ' ||
      header.alg !== 'EdDSA' ||
      header.kid !== fingerprint ||
      header.typ !== 'dotx-device+jws'
    )
      return false;
    if (payload !== Buffer.from(challenge).toString('base64url')) return false;
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(protectedPart + '.' + payload),
    );
  } catch {
    return false;
  }
}
