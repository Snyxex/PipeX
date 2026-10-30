import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkReleaseSpec, inspectRegistry } from '../../scripts/release-preflight.mjs';

const manifest = {
  name: '@snyxex/pipex',
  version: '1.0.2',
  type: 'module',
  license: 'MIT',
  engines: { node: '>=22' },
  repository: { url: 'git+https://github.com/Snyxex/PipeX.git' },
  bugs: { url: 'https://github.com/Snyxex/PipeX/issues' },
  files: ['dist', 'LICENSE', 'README.md', 'SECURITY.md', 'CHANGELOG.md', 'docs/architecture.md'],
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
  scripts: { prepublishOnly: 'npm test' },
};

test('valid scoped candidate passes offline metadata checks', () => {
  assert.deepEqual(checkReleaseSpec(manifest, '@snyxex/pipex', '1.0.2', ['v1.0.1']), []);
});

test('unscoped third-party package name is never approved for publication', () => {
  const result = checkReleaseSpec({ ...manifest, name: 'pipex' }, 'pipex', '1.0.2');
  assert.ok(result.some(error => error.includes('unscoped')));
});

test('version reuse, mismatches and unsafe file lists are blocked', () => {
  const candidate = { ...manifest, files: [...manifest.files, 'docs/jenkins.md'] };
  const result = checkReleaseSpec(candidate, '@another/pipex', '1.0.3', ['v1.0.2']);
  assert.ok(result.some(error => error.includes('tag already exists')));
  assert.ok(result.some(error => error.includes('name does not match')));
  assert.ok(result.some(error => error.includes('version must match')));
  assert.ok(result.some(error => error.includes('internal CI')));
});

test('npm registry checks distinguish absent packages from existing versions', async () => {
  const absent = await inspectRegistry('@snyxex/pipex', '1.0.2', async () => ({
    status: 404, ok: false,
  }));
  assert.deepEqual(absent, { packageExists: false, versionExists: false });
  const exists = await inspectRegistry('@snyxex/pipex', '1.0.2', async () => ({
    status: 200,
    ok: true,
    json: async () => ({ name: '@snyxex/pipex', versions: { '1.0.1': {}, '1.0.2': {} } }),
  }));
  assert.deepEqual(exists, { packageExists: true, versionExists: true });
});

test('registry identity mismatch and network failures reject a release check', async () => {
  await assert.rejects(inspectRegistry('@snyxex/pipex', '1.0.2', async () => ({
    status: 200, ok: true, json: async () => ({ name: 'other-package' }),
  })), /unexpected package/);
  await assert.rejects(inspectRegistry('@snyxex/pipex', '1.0.2', async () => ({
    status: 503, ok: false,
  })), /HTTP 503/);
});

test('public npm publishing settings and registry are mandatory', () => {
  const missing = checkReleaseSpec({ ...manifest, publishConfig: undefined }, '@snyxex/pipex', '1.0.2');
  assert.ok(missing.some(error => error.includes('publishConfig.access')));
  assert.ok(missing.some(error => error.includes('official npm registry')));

  const privateAccess = checkReleaseSpec({
    ...manifest,
    publishConfig: { access: 'restricted', registry: 'https://registry.npmjs.org/' },
  }, '@snyxex/pipex', '1.0.2');
  assert.ok(privateAccess.some(error => error.includes('publishConfig.access')));

  const wrongRegistry = checkReleaseSpec({
    ...manifest,
    publishConfig: { access: 'public', registry: 'https://example.invalid/' },
  }, '@snyxex/pipex', '1.0.2');
  assert.ok(wrongRegistry.some(error => error.includes('official npm registry')));
});
