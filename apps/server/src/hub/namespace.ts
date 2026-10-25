import type { Env } from '../env.ts';
import type { DeviceHub } from './device-hub.ts';
import type { HttpFailure } from '@dotx/shared/http/admin';
import type { AuthRequest, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { ConsentContext } from '@dotx/shared/http/consent';
import type { Transactions } from '../oauth/transactions.ts';
import { HttpError } from '../http/responses.ts';
type HubRpc = Pick<DeviceHub, 'connectionSummary' | 'eventRequest' | 'invoke'>;
export function hub(env: Pick<Env, 'DEVICES'>) {
  return env.DEVICES.getByName('devices') as DurableObjectStub & HubRpc;
}
// Internal control messages stay within the Worker/DO binding. Public HTTP never exposes this prefix.
export async function control<T>(env: Env, path: string, input: unknown): Promise<T> {
  const response = await hub(env).fetch(
    new Request('https://hub/internal/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  const body = await response.json<T | HttpFailure>();
  if (!response.ok) {
    const { error } = body as HttpFailure;
    throw new HttpError(response.status, error.code, error.message, error.details);
  }
  return body as T;
}
export function consentHub(env: Env) {
  return {
    createConsent: (request: AuthRequest, description: ConsentDescription, binding: string) =>
      control<string>(env, 'consent/create', { request, description, binding }),
    consentContext: (id: string, binding: string) =>
      control<ConsentContext>(env, 'consent/context', { id, binding }),
    reserveConsent: (id: string, binding: string, code: string) =>
      control<Awaited<ReturnType<Transactions['reserve']>>>(env, 'consent/reserve', {
        id,
        binding,
        code,
      }),
    completeConsent: (id: string, binding: string, redirect: string) =>
      control<string>(env, 'consent/complete', { id, binding, redirect }),
    cancelConsent: (id: string, binding: string) =>
      control<string>(env, 'consent/cancel', { id, binding }),
    consentError: (id: string, binding: string, error: { code: string; message: string }) =>
      control<null>(env, 'consent/error', { id, binding, error }),
  };
}
