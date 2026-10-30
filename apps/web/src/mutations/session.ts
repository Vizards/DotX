import { mutationOptions } from '@tanstack/react-query';
import { logout } from '../api/session.ts';
import { queryClient } from '../query-client.ts';
export const logoutMutation = () =>
  mutationOptions({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
    },
  });
