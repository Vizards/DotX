import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync } from 'node:crypto';
import { publicKeySchema } from '@dotx/shared/http/enrollment';
import { writePrivate } from './files.ts';
export function identity(dir: string, initialize = false) {
  const file = path.join(dir, 'identity/private-key.pem');
  if (!fs.existsSync(file)) {
    if (!initialize || fs.existsSync(path.join(dir, 'config.json')))
      throw new Error('DEVICE_PRIVATE_KEY_MISSING');
    const pair = generateKeyPairSync('ed25519');
    writePrivate(file, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(fs.readFileSync(file, 'utf8'));
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error();
  } catch {
    throw new Error('DEVICE_PRIVATE_KEY_INVALID');
  }
  const key = createPublicKey(privateKey),
    publicKey = publicKeySchema.parse(key.export({ format: 'jwk' })),
    keyId = createHash('sha256')
      .update(key.export({ format: 'der', type: 'spki' }))
      .digest('base64url');
  return { privateKey, publicKey, keyId };
}
export type Identity = ReturnType<typeof identity>;
