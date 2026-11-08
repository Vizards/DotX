import fs from 'node:fs';
import { build } from 'esbuild';

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
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as bundleRequire } from 'node:module'; const require = bundleRequire(import.meta.url);",
  },
});
for (const file of ['runtime.ps1', 'private-directory.ps1'])
  fs.copyFileSync(`plugin/${file}`, `dist/${file}`);
