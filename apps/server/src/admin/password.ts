import { scryptSync } from 'node:crypto';
import { randomSecret, sameSecret } from '../http/crypto.ts';
import { HttpError } from '../http/responses.ts';

export interface PasswordHash {
  salt: string;
  hash: string;
}
// OWASP's 32 MiB scrypt profile. Run in DeviceHub, whose CPU budget supports
// password hashing; the public Worker only forwards the request.
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: string) =>
  scryptSync(password, salt, 32, parameters).toString('base64url');
export function passwordHash(password: unknown): PasswordHash {
  if (typeof password !== 'string' || password.length === 0)
    throw new HttpError(400, 'PASSWORD_REQUIRED', 'Enter a password.');
  const salt = randomSecret(16);
  return { salt, hash: derive(password, salt) };
}
export function passwordMatches(password: unknown, saved: PasswordHash) {
  return typeof password === 'string' && sameSecret(derive(password, saved.salt), saved.hash);
}
