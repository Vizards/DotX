import { queryOptions } from '@tanstack/react-query';
import { agents } from '../api/agents.ts';
export const agentsQuery = () =>
  queryOptions({
    queryKey: ['admin', 'agents'],
    queryFn: ({ signal }) => agents(signal),
  });
