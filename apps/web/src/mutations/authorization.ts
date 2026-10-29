import { mutationOptions } from '@tanstack/react-query';
import { submitAuthorization, decideAuthorization } from '../api/authorization.ts';
import { queryClient } from '../query-client.ts';
export const authorizationMutation = () => mutationOptions({ mutationFn: submitAuthorization });
export const approvalMutation = (csrf: string) =>
  mutationOptions({
    mutationFn: (input: Parameters<typeof decideAuthorization>[0]) =>
      decideAuthorization(input, csrf),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'agent-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'agents'] }),
        queryClient.invalidateQueries({ queryKey: ['authorization'] }),
      ]);
    },
  });
