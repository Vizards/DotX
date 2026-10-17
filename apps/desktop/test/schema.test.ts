import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readNativeCatalog } from '../src/interfaces/app-server/schema.ts';

test('schema always follows the running executable, without a desktop release whitelist or stale cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-schema-test-'));
  const cli = path.join(dir, 'cli');
  const record = path.join(dir, 'record.json');
  const mode = path.join(dir, 'mode');
  fs.writeFileSync(
    cli,
    `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
if(process.argv[2]==='--version')process.exit(1);
const out=process.argv.at(-1),mode=fs.readFileSync(${JSON.stringify(mode)},'utf8');
fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({out,mode}));
if(mode==='failure')process.exit(1);
for(const name of ['ClientRequest','ServerRequest','ServerNotification'])
 fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({oneOf:name==='ClientRequest'?['initialize',mode].map(method=>({properties:{method:{enum:[method]},params:{type:'object',properties:{}}}})):[]}));
`,
    { mode: 0o700 },
  );
  try {
    const directories = new Set<string>();
    for (const method of ['native/old', 'native/new']) {
      fs.writeFileSync(mode, method);
      const native = readNativeCatalog(cli);
      assert.deepEqual(
        native.map((m) => m.name),
        ['initialize', method],
      );
      const { out } = JSON.parse(fs.readFileSync(record, 'utf8'));
      assert.equal(fs.existsSync(out), false);
      directories.add(out);
    }
    assert.equal(directories.size, 2);
    fs.writeFileSync(mode, 'failure');
    assert.throws(() => readNativeCatalog(cli), { code: 'APP_SERVER_SCHEMA_GENERATION_FAILED' });
    const { out } = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
