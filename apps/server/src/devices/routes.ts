import type { Env } from '../env.ts';
import { hub } from '../hub/namespace.ts';
export function deviceRoute(request: Request, env: Env) {
  return hub(env).fetch(request);
}
