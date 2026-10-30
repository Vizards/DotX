import { z } from 'zod';
export const displayName = z.string();
/** A visual matching aid only; approval always uses the complete operation ID. */
export function applicationLabel(operationId: string): string {
  const prefix = operationId.slice(0, 8).toUpperCase();
  return `${prefix.slice(0, 4)}-${prefix.slice(4)}`;
}
export const publicKeySchema = z.strictObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type DevicePublicKey = z.infer<typeof publicKeySchema>;
export const enrollmentInput = z.strictObject({
  operation_id: z.uuid(),
  device_id: z.uuid(),
  name: displayName,
  public_key: publicKeySchema,
});
export type EnrollmentInput = z.infer<typeof enrollmentInput>;
export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked';
export const enrollmentResult = z.object({
  operation_id: z.uuid(),
  device_id: z.uuid(),
  key_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'revoked']),
  expires_at: z.number().finite(),
  approval_url: z.url(),
  guide_url: z.url(),
});
export type EnrollmentResult = z.infer<typeof enrollmentResult>;
