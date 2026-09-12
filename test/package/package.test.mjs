import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));

test('package metadata, lockfile root, and built export targets agree', async () => {
  const lockedRoot = lockfile.packages[''];
  assert.equal(lockedRoot.name, manifest.name);
  assert.equal(lockedRoot.version, manifest.version);
  assert.deepEqual(lockedRoot.dependencies, manifest.dependencies);
  assert.deepEqual(lockedRoot.devDependencies, manifest.devDependencies);
  assert.deepEqual(lockedRoot.engines, manifest.engines);
  assert.equal(manifest.main, manifest.exports['.'].import);

  for (const conditions of Object.values(manifest.exports)) {
    await access(new URL(`../../${conditions.import.slice(2)}`, import.meta.url));
    await access(new URL(`../../${conditions.types.slice(2)}`, import.meta.url));
  }

  const root = await import('pipex');
  const kms = await import('pipex/plugins/kms');
  assert.equal(typeof root.DataEngine, 'function');
  assert.equal(typeof kms.KmsEncryptionPlugin, 'function');
});

test('dry-run tarball contains only the public release payload', () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'npm_execpath is required; run this check through npm');
  const output = execFileSync(process.execPath, [
    npmCli,
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts',
    '--cache',
    '.npm',
  ], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
  const [pack] = JSON.parse(output);
  const actual = pack.files.map(file => file.path).sort();
  assert.deepEqual(actual, [
    'LICENSE',
    'README.md',
    'dist/index.d.mts',
    'dist/index.d.mts.map',
    'dist/index.mjs',
    'dist/index.mjs.map',
    'docs/architecture.md',
    'docs/enterprise.md',
    'package.json',
  ]);
});
