import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { stateDir } from '../runtime/state.ts';
import { SetupState, api } from './state.ts';
import { resolveService } from './discovery.ts';
import { bootstrap } from '../bootstrap/caller.ts';
import { enroll } from './enrollment.ts';

process.umask(0o077);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    state: { type: 'string' },
    url: { type: 'string' },
    'service-file': { type: 'string' },
    approve: { type: 'boolean', default: false },
  },
});
const command = positionals[0] ?? 'status';
const dir = values.state ?? stateDir();
const state = new SetupState(dir);
const out = (value: unknown) => console.log(JSON.stringify(value));
if (command === 'status') {
  out({
    ...state.value,
    state_dir: dir,
    local_config_present: fs.existsSync(path.join(dir, 'config.json')),
    connection_config_present: fs.existsSync(path.join(dir, 'connection.json')),
    owner_credential_present: fs.existsSync(path.join(state.dir, 'owner-key')),
  });
} else {
  const unlock = state.lock();
  try {
    if (command === 'owner-key-hash') {
      // Only the digest leaves this process; pipe it to Wrangler secret put.
      console.log(createHash('sha256').update(state.secret('owner-key')).digest('hex'));
    } else if (command === 'select-service') {
      const info = await resolveService({
        discovery: values['service-file']
          ? JSON.parse(fs.readFileSync(values['service-file'], 'utf8'))
          : undefined,
        url: values.url,
        savedOrigin: state.value.origin,
      });
      state.save({ origin: info.origin });
      out(info);
    } else if (command === 'init-local') out(await bootstrap(dir));
    else if (command === 'enroll') out(await enroll(state, dir, values.approve));
    else if (command === 'admin-link') {
      if (!state.value.origin) throw new Error('SERVICE_NOT_SELECTED');
      const result = await api<{ url: string }>(
        state.value.origin,
        '/setup/browser',
        {},
        state.ownerKey(),
      );
      // GPT chooses when and in which UI session to use the one-time credential.
      out({ origin: state.value.origin, login_url: result.url });
    } else
      throw new Error(
        'Usage: setup.mjs status|owner-key-hash|select-service [--service-file FILE | --url URL]|init-local|enroll [--approve]|admin-link',
      );
  } finally {
    unlock();
  }
}
