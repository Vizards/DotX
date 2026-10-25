import { mutationOptions } from '@tanstack/react-query';
import { submitAuthorization } from '../api/authorization.ts';
export const authorizationMutation = () => mutationOptions({ mutationFn: submitAuthorization });
