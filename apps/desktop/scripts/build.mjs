import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
// Assemble the same Desktop ZIP on every build host without installing every
// dependency's Windows variants. Keep this pin in sync with koffi and the lockfile.
const nativeVersion = '3.3.4';
const nativeIntegrity =
  '/SpehfYrO9DtkoB0ZOgGyco4GH4zwhEyFqgCm0x8lbzXnrKiwnHXWmPpfuXhFYohFvoSO5jlLQz/hc1fJ5G0AQ==';
if (
  JSON.parse(fs.readFileSync(path.join(koffiRoot, 'package.json'), 'utf8')).version !==
  nativeVersion
)
  throw new Error('Update the pinned Windows binding when updating koffi');
const archive = path.resolve('node_modules/.cache/dotx', `koffi-win32-x64-${nativeVersion}.tgz`);
let bytes;
try {
  bytes = fs.readFileSync(archive);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const response = await fetch(
    `https://registry.npmjs.org/@koromix/koffi-win32-x64/-/koffi-win32-x64-${nativeVersion}.tgz`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Windows binding download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha512').update(bytes).digest('base64') !== nativeIntegrity)
  throw new Error(`Windows binding integrity mismatch; remove ${archive} before retrying`);
fs.mkdirSync(path.dirname(archive), { recursive: true });
fs.writeFileSync(archive, bytes);
const nativeTarget = 'dist/node_modules/@koromix/koffi-win32-x64';
fs.mkdirSync(nativeTarget, { recursive: true });
execFileSync('tar', [
  '-xzf',
  archive,
  '-C',
  nativeTarget,
  '--strip-components=1',
  'package/package.json',
  'package/index.js',
  'package/win32_x64/koffi.node',
]);
fs.copyFileSync('plugin/runtime.ps1', 'dist/runtime.ps1');
