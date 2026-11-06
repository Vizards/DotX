import { Buffer } from 'node:buffer';
import type { Store } from '../hub/storage.ts';

// Each Server owns its encryption key. No central service receives this key,
// PKCE verifiers or provider credentials. This protects stored payloads from
// accidental plaintext disclosure, not from an administrator of this Worker.
export class AdminVault {
  private key?: Promise<CryptoKey>;
  private readonly store: DurableObjectStorage;
  constructor(store: DurableObjectStorage) {
    this.store = store;
  }
  private encryptionKey() {
    return (this.key ??= this.store
      .transaction(async (tx) => {
        let bytes = await tx.get<string>('admin:oauth:encryption-key');
        if (!bytes) {
          bytes = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
          await tx.put('admin:oauth:encryption-key', bytes);
        }
        return crypto.subtle.importKey('raw', Buffer.from(bytes, 'base64url'), 'AES-GCM', false, [
          'encrypt',
          'decrypt',
        ]);
      })
      .catch((error) => {
        this.key = undefined;
        throw error;
      }));
  }
  async seal(value: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.encryptionKey(),
      new TextEncoder().encode(JSON.stringify(value)),
    );
    return Buffer.concat([iv, Buffer.from(data)]).toString('base64url');
  }
  async open<T>(value: string): Promise<T> {
    const data = Buffer.from(value, 'base64url');
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: data.subarray(0, 12) },
          await this.encryptionKey(),
          data.subarray(12),
        ),
      ),
    ) as T;
  }
}

export async function saveExpiring(tx: Store, key: string, value: { expires_at: number }) {
  await tx.put(key, value);
  const alarm = await tx.getAlarm();
  if (alarm === null || alarm > value.expires_at) await tx.setAlarm(value.expires_at);
}
