import { mutationOptions } from '@tanstack/react-query';
import * as api from '../api/agents.ts';
import { queryClient } from '../query-client.ts';
import { agentsQuery } from '../queries/agents.ts';
const refresh = () => queryClient.invalidateQueries(agentsQuery());
export const renameAgentMutation = (csrf: string) =>
  mutationOptions({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameAgent(id, name, csrf),
    onSettled: refresh,
  });
export const revokeAgentMutation = (csrf: string) =>
  mutationOptions({ mutationFn: (id: string) => api.revokeAgent(id, csrf), onSettled: refresh });
