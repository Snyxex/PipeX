import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const runner = resolve('scripts/run-test-suite.mjs');

function run(path, timeout = 1_000) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [runner, `--timeout=${timeout}`, path], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
}

test('suite runner discovers tests and propagates failures and timeouts', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pipex-test-runner-'));
  try {
    const passing = join(root, 'passing.test.mjs');
    const failing = join(root, 'failing.test.mjs');
    const hanging = join(root, 'hanging.test.mjs');
    await writeFile(passing, "import { test } from 'node:test'; test('pass', () => {});\n");
    await writeFile(failing, "import { test } from 'node:test'; test('fail', () => { throw new Error('expected failure'); });\n");
    await writeFile(hanging, "import { test } from 'node:test'; test('timeout', async () => new Promise(() => {}));\n");

    const passed = run(passing);
    assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
    const failed = run(failing);
    assert.notEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    const timedOut = run(hanging, 100);
    assert.notEqual(timedOut.status, 0);
    assert.match(`${timedOut.stdout}\n${timedOut.stderr}`, /timeout|cancelled/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every automated test belongs to an explicit suite', async () => {
  const testRoot = resolve('test');
  const allowedSuites = new Set(['consumer', 'integration', 'package', 'performance', 'security', 'tooling', 'unit']);
  async function findTests(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? findTests(path) : Promise.resolve(path.endsWith('.test.mjs') ? [path] : []);
    }));
    return nested.flat();
  }
  const testFiles = await findTests(testRoot);
  assert.ok(testFiles.length > 0);
  for (const file of testFiles) {
    const suite = file.slice(testRoot.length + 1).split(/[\\/]/, 1)[0];
    assert.ok(allowedSuites.has(suite), `${file} is not assigned to a known test suite`);
  }

  const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  for (const suite of ['tooling', 'unit', 'integration', 'security', 'package', 'consumer']) {
    assert.match(manifest.scripts.test, new RegExp(`npm run test:${suite}`));
  }
  assert.doesNotMatch(manifest.scripts.test, /performance|benchmark/);

  const jenkinsfile = await readFile(resolve('Jenkinsfile'), 'utf8');
  const jenkinsDocs = await readFile(resolve('docs/jenkins.md'), 'utf8');
  assert.match(jenkinsfile, /agent \{ label 'linux' \}/);
  assert.match(jenkinsfile, /disableConcurrentBuilds\(\)/);
  assert.match(jenkinsfile, /skipDefaultCheckout\(true\)/);
  assert.match(jenkinsfile, /checkout scm/);
  assert.match(jenkinsfile, /CHANGE_ID/);
  assert.match(jenkinsfile, /CHANGE_FORK/);
  assert.match(jenkinsfile, /Prepare PR merge test/);
  assert.match(jenkinsfile, /Validate AI skills/);
  assert.doesNotMatch(jenkinsfile, /^<{7}|^={7}|^>{7}/m);
  assert.match(jenkinsfile, /merge --no-commit --no-ff origin\/main/);
  assert.match(jenkinsfile, /getContext\(hudson\.FilePath\)/);
  assert.match(jenkinsfile, /mise exec node@26/);
  assert.match(jenkinsfile, /mise exec node@22/);
  assert.match(jenkinsfile, /mise exec node@24/);
  assert.doesNotMatch(jenkinsfile, /mise exec node@20(?:\.|\b)/);
  assert.match(jenkinsfile, /npm run quality:ci/);
  assert.match(jenkinsfile, /npm audit --audit-level=high/);
  assert.match(jenkinsfile, /PIPEX_GITHUB_INSTALL_SPEC/);
  assert.match(jenkinsfile, /archiveArtifacts artifacts: '.artifacts\/\*\.tgz,dist\/\*\*'/);
  assert.doesNotMatch(jenkinsfile, /docker compose|run-jenkins-job\.sh/);
  assert.doesNotMatch(jenkinsfile, /benchmark:large|npm publish/);
  assert.match(jenkinsDocs, /Multibranch Pipeline/);
  assert.match(jenkinsDocs, /shared host/);
  assert.doesNotMatch(manifest.scripts['quality:ci'], /benchmark/);
  assert.match(manifest.scripts['quality:ci'], /npm run test:performance:built/);
});
