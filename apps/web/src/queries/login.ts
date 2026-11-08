import { queryOptions } from '@tanstack/react-query';
import { loginMethods, security } from '../api/login.ts';
export const loginMethodsQuery = () =>
  queryOptions({ queryKey: ['login-methods'], queryFn: ({ signal }) => loginMethods(signal) });
export const securityQuery = () =>
  queryOptions({ queryKey: ['admin', 'security'], queryFn: ({ signal }) => security(signal) });
