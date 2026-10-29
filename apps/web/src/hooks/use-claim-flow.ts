import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { claimQuery } from '../queries/claim.ts';
import { startClaimMutation } from '../mutations/claim.ts';

/**
 * One claim, shared by every surface that can start or resume one: the sign-in
 * screen, the recovery dialog and the expired setup-link page. Starting a claim
 * replaces any unfinished one only after the request succeeds.
 */
export function useClaimFlow(watch: boolean) {
  const client = useQueryClient();
  const query = useQuery(claimQuery(watch));
  const start = useMutation(startClaimMutation());

  const begin = async (restart = false) => {
    await client.cancelQueries({ queryKey: claimQuery().queryKey });
    client.setQueryData(claimQuery().queryKey, await start.mutateAsync(restart));
  };

  return { query, start, begin, starting: start.isPending, error: start.error };
}
