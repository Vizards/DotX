import { HttpError } from '../http/responses.ts';
import type { Store } from './storage.ts';

export const attemptKeys = {
  login: 'admin:browser:attempts',
  // Credential changes clear admin:browser: records, but must retain this budget.
  cloudflare: 'admin:oauth:attempts',
  enrollment: 'device-enrollment:attempts',
};
const loginPolicy = {
  code: 'LOGIN_ATTEMPTS_EXHAUSTED',
  message: () => 'Too many login attempts. Try again after this one-minute window.',
};
const policies = {
  login: loginPolicy,
  cloudflare: loginPolicy,
  enrollment: {
    code: 'ENROLLMENT_ATTEMPTS_EXHAUSTED',
    message: (seconds: number) =>
      `Too many new device requests on this Server. Try again in ${seconds} seconds. Existing requests can still continue.`,
  },
};

/** Call within the transaction that consumes the budget. Each operation has its own counter. */
export async function consumeAttempt(tx: Store, kind: keyof typeof policies) {
  const policy = policies[kind];
  const key = attemptKeys[kind];
  const now = Date.now();
  let budget = await tx.get<{ count: number; expires_at: number }>(key);
  if (!budget || budget.expires_at <= now) budget = { count: 0, expires_at: now + 60_000 };
  if (budget.count >= 10) {
    const seconds = Math.ceil((budget.expires_at - now) / 1000);
    throw new HttpError(429, policy.code, policy.message(seconds), {
      retry_after_seconds: seconds,
    });
  }
  budget.count++;
  // Fixed counters reset on use; they do not need their own alarms.
  await tx.put(key, budget);
}
