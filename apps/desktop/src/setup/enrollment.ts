import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { DeviceConfig } from '../runtime/config.ts';
import { readJson, writeJson } from '../runtime/state.ts';
import { api, type SetupState } from './state.ts';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export async function enroll(state: SetupState, dir: string, approve = false) {
  const origin = state.value.origin;
  if (!origin) throw new Error('SERVICE_NOT_SELECTED');
  const config = readJson<DeviceConfig>(path.join(dir, 'config.json'));
  const token = state.secret('device-token'),
    claim = state.secret('claim-token');
  // Reconcile an already accepted identity before renewing an expired pairing attempt.
  if (state.value.enrollmentId) {
    try {
      const result = await api<{ approved: boolean }>(
        origin,
        '/setup/enroll/status',
        { operation_id: state.value.enrollmentId },
        claim,
      );
      if (result.approved) {
        writeJson(path.join(dir, 'connection.json'), { relayUrl: origin, deviceToken: token });
        return { approved: true, device_id: config.deviceId };
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !['ENROLLMENT_EXPIRED', 'ENROLLMENT_NOT_FOUND'].includes(error.message)
      )
        throw error;
      // Only a new approval attempt, same device ID and private token. No cloud deployment.
      state.save({ enrollmentId: randomUUID() });
    }
  } else state.save({ enrollmentId: randomUUID() });
  const operation_id = state.value.enrollmentId!;
  const result = await api<{ approved: boolean; expires: number }>(origin, '/setup/enroll', {
    operation_id,
    device_id: config.deviceId,
    label: config.label,
    token_hash: sha(token),
    claim_hash: sha(claim),
  });
  if (result.approved) return enroll(state, dir);
  if (approve) {
    await api(origin, '/setup/approve', { operation_id }, state.ownerKey());
    return enroll(state, dir);
  }
  return {
    approved: false,
    expires: result.expires,
    approval_url: origin + '/setup/pair/' + operation_id,
    label: config.label,
    fingerprint: sha(token).slice(0, 16),
  };
}
