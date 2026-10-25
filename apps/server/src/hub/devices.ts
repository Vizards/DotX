import type { EnrollmentInput, EnrollmentResult } from '@dotx/shared/http/enrollment';
import type { DeviceRequest } from '@dotx/shared/http/admin';
import { canonical } from '@dotx/shared/wire/commands';
import { HttpError } from '../http/responses.ts';
import { keyId } from '../devices/proof.ts';
import type { AtomicStore, Store } from './storage.ts';
export interface DeviceRecord extends DeviceRequest {
  approved_at: number | null;
}
const key = (id: string) => 'device:' + id;
const operationKey = (id: string) => 'device-request:' + id;
const lifetime = 7 * 24 * 3600_000;
function current<T extends DeviceRequest>(record: T): T {
  return record.status === 'pending' && record.expires_at <= Date.now()
    ? { ...record, status: 'expired' }
    : record;
}
export class Devices {
  readonly store: AtomicStore;
  readonly origin: string;
  readonly guide: string;
  constructor(store: AtomicStore, origin: string, guide: string) {
    this.store = store;
    this.origin = origin;
    this.guide = guide;
  }
  async get(id: string, store: Store = this.store) {
    const record = await store.get<DeviceRecord>(key(id));
    return record ? current(record) : undefined;
  }
  result(record: DeviceRequest): EnrollmentResult {
    return {
      operation_id: record.operation_id,
      device_id: record.device_id,
      key_id: record.key_id,
      status: current(record).status,
      expires_at: record.expires_at,
      approval_url:
        this.origin + '/admin/devices?operation_id=' + encodeURIComponent(record.operation_id),
      guide_url: this.guide,
    };
  }
  async enroll(input: EnrollmentInput) {
    const fingerprint = await keyId(input.public_key);
    return this.store.transaction(async (tx) => {
      const prior = await tx.get<DeviceRequest>(operationKey(input.operation_id));
      if (prior) {
        if (
          prior.device_id !== input.device_id ||
          prior.name !== input.name ||
          canonical(prior.public_key) !== canonical(input.public_key)
        )
          throw new HttpError(409, 'APPLICATION_CONFLICT');
        return this.result(prior);
      }
      const device = await this.get(input.device_id, tx);
      if (device && device.key_id !== fingerprint) throw new HttpError(409, 'DEVICE_KEY_CONFLICT');
      if (device && ['pending', 'approved'].includes(device.status)) return this.result(device);
      const record: DeviceRecord = {
        ...input,
        key_id: fingerprint,
        status: 'pending',
        created_at: Date.now(),
        expires_at: Date.now() + lifetime,
        approved_at: null,
      };
      await tx.put(key(input.device_id), record);
      await tx.put(operationKey(input.operation_id), record);
      return this.result(record);
    });
  }
  async list() {
    return [...(await this.store.list<DeviceRecord>({ prefix: 'device:' })).values()].map(current);
  }
  async requests() {
    return [...(await this.store.list<DeviceRequest>({ prefix: 'device-request:' })).values()].map(
      current,
    );
  }
  async decide(operation: string, decision: 'approve' | 'reject') {
    return this.store.transaction(async (tx) => {
      const request = await tx.get<DeviceRequest>(operationKey(operation));
      if (!request) throw new HttpError(404, 'APPLICATION_NOT_FOUND');
      const record = await this.get(request.device_id, tx);
      if (!record || record.operation_id !== operation)
        throw new HttpError(409, 'APPLICATION_REPLACED');
      const status = decision === 'approve' ? 'approved' : 'rejected';
      if (record.status === status) return record;
      if (record.status !== 'pending') throw new HttpError(409, 'APPLICATION_NOT_PENDING');
      const next: DeviceRecord = {
        ...record,
        status,
        approved_at: decision === 'approve' ? Date.now() : null,
      };
      await tx.put(key(record.device_id), next);
      await tx.put(operationKey(operation), next);
      return next;
    });
  }
  async revoke(id: string) {
    return this.store.transaction(async (tx) => {
      const record = await this.get(id, tx);
      if (!record?.approved_at) throw new HttpError(404, 'DEVICE_NOT_FOUND');
      const next: DeviceRecord = { ...record, status: 'revoked' };
      await tx.put(key(id), next);
      await tx.put(operationKey(record.operation_id), next);
      return next;
    });
  }
}
