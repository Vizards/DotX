import { z } from 'zod';

const SUPER_ADMIN = '8e23b19e4e0d44c29d239c5688ba8cbb';
const WORKER_ADMIN = 'e99ac7f52b564790946ff5606061979d';
const WORKER_EDITOR = '55b7b7b20ad14560a58db0121f015c17';
// Select policies covering the target before validating their grant semantics.
// Unrelated resources must not invalidate an otherwise valid Worker permission.
const key = z.strictObject({ key: z.string() });
const metadata = {
  id: z.string().optional(),
  name: z.string().optional(),
  meta: z.unknown().optional(),
};
const membership = z.object({
  id: z.string(),
  status: z.string(),
  account: z.object({ id: z.string() }),
  policies: z.array(z.unknown()).optional(),
});
const policyScope = z.looseObject({
  permission_groups: z.array(z.looseObject({ id: z.string() })),
  resource_groups: z.array(
    z.looseObject({
      scope: z.looseObject({
        key: z.string(),
      }),
    }),
  ),
});
// Unknown constraints on a relevant policy must not become an unconditional
// grant. Descriptive metadata is not used to decide authority.
const grant = z.strictObject({
  id: z.string().optional(),
  access: z.literal('allow'),
  permission_groups: z.array(z.strictObject({ ...metadata, id: z.string() })),
  resource_groups: z.array(
    z.strictObject({
      ...metadata,
      scope: z.strictObject({
        key: z.string(),
        objects: z.array(key),
        subset_of: z.array(key).optional(),
      }),
    }),
  ),
});
export type Membership = z.infer<typeof membership>;
export function qualification(
  member: Membership,
  accountId: string,
  workerId: string,
): string | null {
  const parsed = membership.safeParse(member);
  if (!parsed.success || parsed.data.status !== 'accepted' || parsed.data.account.id !== accountId)
    return null;
  const policies = parsed.data.policies ?? [];
  const account = 'com.cloudflare.api.account.' + accountId,
    worker = 'com.cloudflare.edge.worker.script.' + workerId;
  let reason: string | null = null;
  for (const raw of policies) {
    const scoped = policyScope.safeParse(raw);
    if (!scoped.success) return null; // Cannot establish which resource this policy affects.
    const permission_groups = scoped.data.permission_groups.filter((g) =>
      [SUPER_ADMIN, WORKER_ADMIN, WORKER_EDITOR].includes(g.id),
    );
    const resource_groups = scoped.data.resource_groups.filter(
      ({ scope }) => scope.key === account || scope.key === worker,
    );
    if (!permission_groups.length || !resource_groups.length) continue;
    const relevant = grant.safeParse({ ...scoped.data, permission_groups, resource_groups });
    if (!relevant.success) return null;
    const permissions = relevant.data.permission_groups.map((g) => g.id);
    for (const resource of relevant.data.resource_groups) {
      const scope = resource.scope;
      if (scope.objects.length !== 1 || scope.objects[0]?.key !== '*') continue;
      const targetAccount = scope.key === account && !scope.subset_of?.length;
      if (targetAccount && permissions.includes(SUPER_ADMIN)) reason = 'TARGET_ACCOUNT_SUPER_ADMIN';
      if (!permissions.some((p) => p === WORKER_ADMIN || p === WORKER_EDITOR)) continue;
      if (
        targetAccount ||
        (scope.key === worker &&
          scope.subset_of?.length === 1 &&
          scope.subset_of[0]?.key === account)
      )
        reason ??= 'TARGET_WORKER_DIRECT_EDITOR_OR_ADMIN';
    }
  }
  return reason;
}
