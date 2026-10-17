import type { RegisteredDevice } from '@dotx/shared/protocol';
import type { Env } from '../env.ts';

// A single hub per deployment namespace, with no placement preference.
export const HUB_NAME = 'devices';
export function hub(env: Pick<Env, 'DEVICES'>) {
  return env.DEVICES.getByName(HUB_NAME);
}
export function isCurrentHub(id: { toString(): string }, env: Partial<Pick<Env, 'DEVICES'>>) {
  return !!env.DEVICES && id.toString() === env.DEVICES.idFromName(HUB_NAME).toString();
}

export async function registered(env: Env) {
  return (await hub(env).fetch('https://hub/registry')).json<RegisteredDevice[]>();
}
