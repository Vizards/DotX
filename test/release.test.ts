import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { WIRE_VERSION } from '@dotx/shared/gateway';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflow = parse(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
const buildSteps = workflow.jobs.build.steps;
const versionStep = buildSteps.find((s: any) => s.name === 'Set artifact version').run;
const assembly = buildSteps.find((s: any) => s.name === 'Assemble release attachments').run;
const planning = workflow.jobs.prepare.steps.find((s: any) => s.id === 'plan').with.script;
const publication = workflow.jobs.publish.steps.find(
  (s: any) => s.uses === 'actions/github-script@v9',
).with.script;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function fixture(t: import('node:test').TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotx-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of [
    'LICENSE',
    'package.json',
    'apps/desktop/package.json',
    'apps/server/package.json',
    'packages/shared/package.json',
    'packages/shared/src/gateway.ts',
    'apps/desktop/plugin',
    'apps/desktop/skills',
    'apps/desktop/marketplace.json',
    'apps/desktop/README.md',
    'apps/server/README.md',
    'apps/server/wrangler.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.cpSync(path.join(root, file), path.join(dir, file), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.github/release-changes.json'),
    JSON.stringify({
      base_release: null,
      changes: { server: true, desktop: true, remote_catalog: true },
    }),
  );
  fs.symlinkSync(
    path.join(root, 'packages/shared/node_modules'),
    path.join(dir, 'packages/shared/node_modules'),
    'dir',
  );
  for (const file of [
    'apps/desktop/dist/plugin.mjs',
    'apps/desktop/dist/setup/cli.mjs',
    'apps/server/dist/worker.mjs',
  ]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'export const fixture = true;\n');
  }
  const env = {
    ...process.env,
    VERSION: '0.0.1',
    GITHUB_REPOSITORY: 'example/dotx',
    SOURCE_SHA: 'test-source',
    BASE_RELEASE: '',
  };
  const run = (script: string) =>
    execFileSync('/bin/bash', ['-e', '-c', script], { cwd: dir, env, stdio: 'pipe' });
  return { dir, env, run };
}

test('Actions assembles independent portable artifacts for stable and development versions', (t) => {
  const f = fixture(t);
  for (const version of ['0.0.1', '0.0.1-dev.1.1']) {
    fs.rmSync(path.join(f.dir, 'dist'), { recursive: true, force: true });
    f.env.VERSION = version;
    f.run(versionStep);
    f.run(assembly);
    const assets = path.join(f.dir, 'dist/release/assets');
    assert.deepEqual(
      fs.readdirSync(assets).sort(),
      [
        `dotx-desktop-${version}.zip`,
        `dotx-server-${version}.zip`,
        'release.json',
        'update-SKILL.md',
      ].sort(),
    );
    const metadata = JSON.parse(fs.readFileSync(path.join(assets, 'release.json'), 'utf8'));
    assert.equal(metadata.release, version);
    assert.equal(metadata.wire_protocol, WIRE_VERSION);
    assert.equal(metadata.base_release, null);
    assert.deepEqual(metadata.changes, { server: true, desktop: true, remote_catalog: true });
    const list = (name: string) =>
      execFileSync('unzip', ['-Z1', path.join(assets, name)], { encoding: 'utf8' });
    const desktop = list(metadata.assets.desktop);
    assert.match(desktop, /\.agents\/plugins\/marketplace\.json/);
    assert.match(desktop, /plugins\/dotx-desktop\/skills\/update\/SKILL.md/);
    assert.doesNotMatch(desktop, /worker\.mjs|wrangler\.json|toolchain\.json|node_modules/);
    const server = list(metadata.assets.server);
    assert.match(server, /worker\.mjs/);
    assert.doesNotMatch(server, /connector\.mjs|\.codex-plugin|node_modules/);
    for (const directory of ['desktop', 'desktop/plugins/dotx-desktop', 'server'])
      assert.equal(
        fs.readFileSync(path.join(f.dir, 'dist/release', directory, 'LICENSE'), 'utf8'),
        fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
      );
    const plugin = path.join(f.dir, 'dist/release/desktop/plugins/dotx-desktop');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(plugin, '.codex-plugin/plugin.json'), 'utf8'),
    );
    assert.equal(manifest.version, version);
    assert(fs.statSync(path.join(plugin, 'launch.sh')).mode & 0o111);
    const config = JSON.parse(
      fs.readFileSync(path.join(f.dir, 'dist/release/server/wrangler.json'), 'utf8'),
    );
    assert.equal(config.vars.RELEASE_REPOSITORY, 'example/dotx');
    assert.equal(config.main, 'worker.mjs');
    assert.equal(config.durable_objects.bindings.length, 1);
  }
});

test('release metadata cannot omit flags, contradict catalog impact or use the wrong baseline', (t) => {
  const f = fixture(t);
  for (const change of [
    { base_release: null, changes: { server: true, desktop: true } },
    { base_release: null, changes: { server: false, desktop: true, remote_catalog: true } },
    { base_release: '0.0.2', changes: { server: true, desktop: true, remote_catalog: true } },
  ]) {
    fs.writeFileSync(path.join(f.dir, '.github/release-changes.json'), JSON.stringify(change));
    assert.throws(() => f.run(assembly), /Invalid reviewed release changes/);
  }
});

test('manual release uses a unique prerelease and stable publication uses the release commit', async () => {
  for (const preview of [false, true]) {
    const outputs: Record<string, string> = {};
    const refs: string[] = [];
    const github = {
      paginate: async () => [
        { id: 7, draft: true, tag_name: preview ? 'v0.0.1-dev.1.1' : 'v0.0.1' },
      ],
      rest: {
        repos: {
          listReleases: () => {},
          getCommit: async ({ ref }: any) => {
            refs.push(ref);
            return { data: { sha: 'pinned-source' } };
          },
          getContent: async ({ path: file }: any) => ({
            data: {
              content: Buffer.from(
                JSON.stringify(
                  file === 'package.json' ? { version: '0.0.1' } : { base_release: null },
                ),
              ).toString('base64'),
            },
          }),
          getLatestRelease: async () => {
            throw { status: 404 };
          },
        },
      },
    };
    const env = {
      RELEASE_CREATED: 'true',
      RELEASE_TAG: 'v0.0.1',
      RELEASE_SHA: 'release-source',
      SOURCE_REF: 'test-branch',
      GITHUB_RUN_ATTEMPT: '1',
    };
    await new AsyncFunction('github', 'context', 'core', 'process', planning)(
      github,
      {
        repo: {},
        eventName: preview ? 'workflow_dispatch' : 'push',
        sha: 'unrelated-push',
        runNumber: 1,
      },
      {
        setOutput: (key: string, value: string) => {
          outputs[key] = value;
        },
      },
      { env },
    );
    assert.deepEqual(refs, [preview ? 'test-branch' : 'release-source']);
    assert.equal(outputs.version, preview ? '0.0.1-dev.1.1' : '0.0.1');
    assert.equal(outputs.sha, 'pinned-source');
    assert.equal(outputs.prerelease, String(preview));
  }
});

test('publication keeps a draft on upload failure and resumes uploads before publishing', async () => {
  const names = [
    'dotx-desktop-0.0.1.zip',
    'dotx-server-0.0.1.zip',
    'release.json',
    'update-SKILL.md',
  ];
  let draft = true;
  const assets: { id: number; name: string; size: number }[] = [];
  let fail = true;
  const repos = {
    getRelease: async () => ({ data: { draft, assets: [...assets] } }),
    deleteReleaseAsset: async ({ asset_id }: any) => {
      assets.splice(
        assets.findIndex((a) => a.id === asset_id),
        1,
      );
    },
    uploadReleaseAsset: async ({ name }: any) => {
      if (fail && name === 'release.json') throw new Error('upload failed');
      assets.push({ id: assets.length + 1, name, size: 1 });
    },
    listReleaseAssets: () => {},
    updateRelease: async (args: any) => {
      assert.deepEqual(assets.map((a) => a.name).sort(), [...names].sort());
      assert.equal(args.prerelease, false);
      draft = args.draft;
    },
  };
  const run = () =>
    new AsyncFunction('github', 'context', 'process', 'require', publication)(
      { rest: { repos }, paginate: async () => assets },
      { repo: {} },
      { env: { VERSION: '0.0.1', RELEASE_ID: '7', PRERELEASE: 'false' } },
      () => ({ readFileSync: () => Buffer.from('x'), statSync: () => ({ size: 1 }) }),
    );
  await assert.rejects(run(), /upload failed/);
  assert.equal(draft, true);
  fail = false;
  await run();
  assert.equal(draft, false);
  await assert.rejects(run(), /Published releases cannot be replaced/);
});
