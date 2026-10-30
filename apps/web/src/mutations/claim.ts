import { mutationOptions } from '@tanstack/react-query';
import { startClaim } from '../api/claim.ts';
export const startClaimMutation = () => mutationOptions({ mutationFn: startClaim });
