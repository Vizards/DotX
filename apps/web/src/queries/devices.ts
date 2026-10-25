import { queryOptions } from '@tanstack/react-query';
import { devices, requests } from '../api/devices.ts';
export const devicesQuery = () =>
  queryOptions({ queryKey: ['admin', 'devices'], queryFn: ({ signal }) => devices(signal) });
export const requestsQuery = () =>
  queryOptions({ queryKey: ['admin', 'requests'], queryFn: ({ signal }) => requests(signal) });
