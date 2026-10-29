import { mutationOptions } from '@tanstack/react-query';
import {
  loginPassword,
  loginPasskey,
  setPassword,
  registerPasskey,
  removeLogin,
  renamePasskey,
  type LoginAuthority,
} from '../api/login.ts';
export const passwordMutation = (auth?: LoginAuthority) =>
  mutationOptions({
    mutationFn: (password: string) =>
      auth ? setPassword(auth, password) : loginPassword(password),
    gcTime: 0,
  });
export const passkeyMutation = (auth?: LoginAuthority) =>
  mutationOptions({
    mutationFn: (name: string) => (auth ? registerPasskey(auth, name) : loginPasskey()),
    gcTime: 0,
  });
export const renamePasskeyMutation = (csrf: string) =>
  mutationOptions({
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePasskey(csrf, id, name),
  });
export const removeLoginMutation = (csrf: string) =>
  mutationOptions({
    mutationFn: (id?: string) => removeLogin(csrf, id),
  });
