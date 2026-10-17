import { Coordinator } from '../../src/state/coordinator.ts';
import type { Dispatch } from '../../src/state/coordinator.ts';
import { Events } from '../../src/events/subscriptions.ts';
import { MemoryStore } from './store.ts';
export const auth = { principal: 'owner', devices: ['mini', 'book'] };
export function coordinator(dispatch: Dispatch, store = new MemoryStore()) {
  const events = new Events(store, { authorized: async () => true, log() {} });
  return { cloud: new Coordinator(store, dispatch, events), store, events };
}
