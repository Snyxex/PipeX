import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const paths = ['.', './compression', './encryption', './hashing', './validation', './parallel', './native', './plugins/kms'];

test('package metadata, lockfile root, and dual ESM/CJS export targets agree', async () => {
  const root = lockfile.packages[''];
  assert.equal(root.name, manifest.name);
  assert.equal(root.version, manifest.version);
  assert.deepEqual(root.dependencies, manifest.dependencies);
  assert.deepEqual(root.devDependencies, manifest.devDependencies);
  assert.deepEqual(root.engines, manifest.engines);
  assert.equal(manifest.main, manifest.exports['.'].require.default);
  assert.equal(manifest.module, manifest.exports['.'].import.default);
  assert.equal(manifest.types, manifest.exports['.'].import.types);
  assert.equal(manifest.scripts.prepare, 'npm run build');
  assert.equal(manifest.repository.url, 'git+https://github.com/Snyxex/PipeX.git');
  assert.equal(manifest.bugs.url, 'https://github.com/Snyxex/PipeX/issues');
  assert.deepEqual(manifest.files, ['dist', 'README.md', 'LICENSE', 'CHANGELOG.md']);
  assert.ok(manifest.devDependencies.tsdown);
  assert.ok(manifest.devDependencies.typescript);
  assert.deepEqual(Object.keys(manifest.exports), paths);
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    assert.deepEqual(Object.keys(conditions).sort(), ['import', 'require', 'types']);
    assert.equal(conditions.types, conditions.import.types);
    assert.match(conditions.import.default, /^\.\/dist\/.+\.mjs$/, subpath);
    assert.match(conditions.import.types, /^\.\/dist\/.+\.d\.mts$/, subpath);
    assert.match(conditions.require.default, /^\.\/dist\/.+\.cjs$/, subpath);
    assert.match(conditions.require.types, /^\.\/dist\/.+\.d\.cts$/, subpath);
    for (const target of [
      conditions.import.default, conditions.import.types,
      conditions.require.default, conditions.require.types,
    ]) {
      await access(new URL('../../' + target.slice(2), import.meta.url));
    }
  }
  const api = await import('@snyxex/pipex');
  const kms = await import('@snyxex/pipex/plugins/kms');
  assert.equal(typeof api.DataEngine, 'function');
  assert.equal(typeof api.getKmsProviderCapabilities, 'function');
  assert.equal(typeof api.KmsProviderAuthenticationError, 'function');
  assert.equal(typeof api.KmsProviderUnavailableError, 'function');
  assert.equal(typeof api.UnsupportedKmsOperationError, 'function');
  assert.equal(typeof api.WorkerQueueFullError, 'function');
  assert.equal(typeof api.WorkerPoolCloseError, 'function');
  assert.equal(typeof kms.KmsEncryptionPlugin, 'function');
});

test('npm dry-run contains only allowlisted published assets and all export targets', () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'npm_execpath is required; run through npm');
  const output = execFileSync(process.execPath, [
    npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts', '--cache', '.npm',
  ], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
  const jsonMatch = /^\[\s*\{/m.exec(output);
  assert.ok(jsonMatch, 'npm pack did not emit JSON package metadata');
  const [pack] = JSON.parse(output.slice(jsonMatch.index));
  const actual = new Set(pack.files.map(file => file.path));
  for (const name of actual) {
    assert.ok(
      name === 'package.json' ||
      name === 'README.md' ||
      name === 'LICENSE' ||
      name === 'CHANGELOG.md' ||
      name.startsWith('dist/'),
      'Unexpected file in npm package: ' + name,
    );
  }
  for (const required of ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    assert.ok(actual.has(required), 'Missing required package file: ' + required);
  }
  for (const conditions of Object.values(manifest.exports)) {
    for (const target of [
      conditions.import.default, conditions.import.types,
      conditions.require.default, conditions.require.types,
    ]) {
      assert.ok(actual.has(target.slice(2)), 'Export target missing from npm tarball: ' + target);
    }
  }
});
