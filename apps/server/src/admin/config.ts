import type { Env } from '../env.ts';
import { control } from '../hub/namespace.ts';
import { HttpError } from '../http/responses.ts';

export interface CloudflareClient {
  client_id: string;
  client_secret: string;
}

export const readClient = (env: Env) =>
  control<CloudflareClient | null>(env, 'admin-setup/config', {});

export async function requireClient(env: Env) {
  const client = await readClient(env);
  if (!client) throw new HttpError(503, 'CF_LOGIN_NOT_CONFIGURED');
  return client;
}
