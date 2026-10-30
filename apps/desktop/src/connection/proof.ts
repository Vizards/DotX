import { sign } from 'node:crypto';
import { challengeSchema } from '@dotx/shared/wire/authentication';
import type { DeviceHello } from '@dotx/shared/wire/authentication';
import type { DeviceConfig } from '../local/config.ts';
import type { Identity } from '../local/identity.ts';
export function prove(
  challenge: string,
  hello: DeviceHello,
  config: DeviceConfig,
  identity: Identity,
) {
  const value = challengeSchema.parse(JSON.parse(challenge));
  if (
    value.origin !== config.service.origin ||
    value.service_id !== config.service.service_id ||
    Object.entries(hello).some(([key, v]) => value[key as keyof typeof value] !== v)
  )
    throw new Error('DEVICE_CHALLENGE_MISMATCH');
  const header = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'dotx-device+jws', kid: identity.keyId }),
    ).toString('base64url'),
    payload = Buffer.from(challenge).toString('base64url'),
    input = header + '.' + payload;
  return {
    proof: input + '.' + sign(null, Buffer.from(input), identity.privateKey).toString('base64url'),
    challenge: value,
  };
}
