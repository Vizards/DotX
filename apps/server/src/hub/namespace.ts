import type { RegisteredDevice } from '@dotx/shared/protocol';
import type { Env } from '../env.ts';

// A single hub per deployment namespace, with no placement preference.
export function hub(env: Pick<Env, 'DEVICES'>) {
  return env.DEVICES.getByName('devices');
}

export async function registered(env: Env) {
  return (await hub(env).fetch('https://hub/registry')).json<RegisteredDevice[]>();
}
