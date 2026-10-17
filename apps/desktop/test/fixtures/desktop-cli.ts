// Synthetic App Server for process lifecycle tests. Never connects to a desktop or model.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

if (process.argv.includes('generate-json-schema')) {
  const dir = process.argv[process.argv.indexOf('--out') + 1];
  for (const name of ['ClientRequest', 'ServerRequest', 'ServerNotification'])
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ oneOf: [] }));
} else {
  const record = (event: string, extra = {}) =>
    fs.appendFileSync(
      path.join(process.env.CODEX_HOME!, 'children.jsonl'),
      JSON.stringify({ event, pid: process.pid, parent: process.ppid, ...extra }) + '\n',
    );
  record('start');
  process.on('exit', () => record('exit'));
  process.on('SIGTERM', () => process.exit(0));
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      record('initialize', { version: request.params.clientInfo.version });
      process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
