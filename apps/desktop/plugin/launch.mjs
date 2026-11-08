import { fileURLToPath } from 'node:url';

process.env.DOTX_PLUGIN_ROOT = fileURLToPath(new URL('.', import.meta.url));
const cli = process.argv[2] === '--cli';
if (cli) process.argv.splice(2, 1);
await import(cli ? './cli.mjs' : './connector.mjs');
