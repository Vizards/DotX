import { mutationOptions } from '@tanstack/react-query';
import * as api from '../api/devices.ts';
import { queryClient } from '../query-client.ts';
import { devicesQuery, requestsQuery } from '../queries/devices.ts';
const refresh = () =>
  Promise.all([
    queryClient.invalidateQueries(devicesQuery()),
    queryClient.invalidateQueries(requestsQuery()),
  ]);
export const decideRequestMutation = (csrf: string) =>
  mutationOptions({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api.decideRequest(id, decision, csrf),
    onSettled: refresh,
  });
export const revokeDeviceMutation = (csrf: string) =>
  mutationOptions({ mutationFn: (id: string) => api.revokeDevice(id, csrf), onSettled: refresh });
