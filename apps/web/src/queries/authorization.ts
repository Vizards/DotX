import { queryOptions } from '@tanstack/react-query';
import { authorization } from '../api/authorization.ts';
export const authorizationQuery = (transaction: string) =>
  queryOptions({
    queryKey: ['authorization', transaction],
    queryFn: ({ signal }) => authorization(transaction, signal),
  });
