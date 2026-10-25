import { queryOptions } from '@tanstack/react-query';
import { session } from '../api/session.ts';
export const sessionQuery = () =>
  queryOptions({ queryKey: ['admin', 'session'], queryFn: ({ signal }) => session(signal) });
