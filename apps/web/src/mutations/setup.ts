import { mutationOptions } from '@tanstack/react-query';
import { completeSetup } from '../api/setup.ts';
export const setupMutation = (secret: string) =>
  mutationOptions({ mutationFn: (token: string) => completeSetup(secret, token), gcTime: 0 });
