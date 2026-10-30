import type { DeviceConfig } from '../local/config.ts';
import { enrollmentResult, type DevicePublicKey } from '@dotx/shared/http/enrollment';
import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { BridgeError } from '@dotx/shared/errors';
export async function enroll(config: DeviceConfig, publicKey: DevicePublicKey) {
  const response = await fetch(config.service.origin + '/setup/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    body: JSON.stringify({
      operation_id: config.operationId,
      device_id: config.deviceId,
      name: config.label,
      public_key: publicKey,
    }),
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    const code = value?.error?.code ?? 'ENROLLMENT_FAILED:' + response.status;
    throw Object.assign(new BridgeError(code, value?.error?.message ?? code), {
      details: value?.error?.details,
    });
  }
  const result = enrollmentResult.parse(await response.json());
  if (result.device_id !== config.deviceId || result.key_id !== config.keyId)
    throw new Error('ENROLLMENT_IDENTITY_MISMATCH');
  if (new URL(result.approval_url).origin !== config.service.origin)
    throw new Error('ENROLLMENT_ORIGIN_MISMATCH');
  return result;
}
