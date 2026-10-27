import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { AdminSetupStatus, AdminSecurity } from '@dotx/shared/http/admin';
import { api } from './client.ts';
export interface LoginAuthority {
  setup?: string;
  claim?: boolean;
  csrf?: string;
}
export const loginMethods = (signal?: AbortSignal) =>
  api<AdminSetupStatus>('/admin/auth/methods', { signal });
export const security = (signal?: AbortSignal) =>
  api<AdminSecurity>('/admin/api/security', { signal });
export const loginPassword = (password: string) =>
  api('/admin/auth/password', { method: 'POST', body: { password } });
export const setPassword = (auth: LoginAuthority, password: string) =>
  api('/admin/auth/password/set', { ...auth, method: 'POST', body: { password } });
export const removeLogin = (csrf: string, id?: string) =>
  api(id === undefined ? '/admin/api/password' : '/admin/api/passkeys/' + encodeURIComponent(id), {
    csrf,
    method: 'DELETE',
  });
export async function loginPasskey() {
  const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>(
    '/admin/auth/passkey/options',
    { method: 'POST', body: {} },
  );
  const response = await startAuthentication({ optionsJSON });
  return api('/admin/auth/passkey/verify', { method: 'POST', body: { response } });
}
export async function registerPasskey(auth: LoginAuthority, name: string) {
  const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
    '/admin/auth/passkey/register/options',
    { ...auth, method: 'POST', body: {} },
  );
  const response = await startRegistration({ optionsJSON });
  return api('/admin/auth/passkey/register/verify', {
    ...auth,
    method: 'POST',
    body: { response, name },
  });
}
