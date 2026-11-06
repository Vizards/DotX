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
export const renamePasskey = (csrf: string, id: string, name: string) =>
  api<{ passkeys: AdminSecurity['passkeys'] }>('/admin/api/passkeys/' + encodeURIComponent(id), {
    csrf,
    method: 'PATCH',
    body: { name },
  });
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

export const startCloudflareLogin = (return_to: string) =>
  api<{ authorization_url: string }>('/admin/auth/cloudflare/start', {
    method: 'POST',
    body: { return_to },
  });
export interface CloudflareLoginStatus {
  return_to: string;
  phase: 'waiting' | 'callback' | 'exchanging' | 'checking' | 'failed';
  failure?: { code: string; email: string | null };
}
export const cloudflareLoginStatus = (signal?: AbortSignal) =>
  api<CloudflareLoginStatus>('/admin/auth/cloudflare/status', { signal });
export const completeCloudflareLogin = () =>
  api<{ return_to: string }>('/admin/auth/cloudflare/complete', { method: 'POST', body: {} });
