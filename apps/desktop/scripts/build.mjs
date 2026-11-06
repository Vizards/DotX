import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
fs.rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/plugin.ts', 'src/cli.ts'],
  outbase: 'src',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['bufferutil', 'utf-8-validate', 'koffi'],
  banner: {
    js: "import { createRequire as bundleRequire } from 'node:module'; const require = bundleRequire(import.meta.url);",
  },
});
// Koffi is loaded lazily on Windows. Copy its runtime and the locked Windows
// binary only; no install scripts, compiler, vendored sources or Mac binary.
const koffiRoot = path.dirname(require.resolve('koffi'));
for (const file of [
  'package.json',
  'index.cjs',
  'src/koffi/index.cjs',
  'src/koffi/src/static.cjs',
  'LICENSE.txt',
]) {
  const target = path.join('dist/node_modules/koffi', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(koffiRoot, file), target);
}
const native = createRequire(require.resolve('koffi')).resolve('@koromix/koffi-win32-x64');
fs.cpSync(path.dirname(native), 'dist/node_modules/@koromix/koffi-win32-x64', { recursive: true });
fs.copyFileSync('plugin/runtime.ps1', 'dist/runtime.ps1');
