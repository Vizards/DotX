import { queryOptions } from '@tanstack/react-query';
import { setupStatus } from '../api/setup.ts';
export const setupQuery = (secret: string) =>
  queryOptions({
    queryKey: ['setup', secret],
    queryFn: ({ signal }) => setupStatus(secret, signal),
  });
