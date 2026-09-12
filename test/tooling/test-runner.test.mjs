import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  const allowedSuites = new Set(['integration', 'package', 'performance', 'security', 'tooling', 'unit']);
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
  for (const suite of ['tooling', 'unit', 'integration', 'security', 'package']) {
    assert.match(manifest.scripts.test, new RegExp(`npm run test:${suite}`));
  }
  assert.doesNotMatch(manifest.scripts.test, /performance|benchmark/);

  const workflow = await readFile(resolve('.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /npm run test:performance/);
  assert.doesNotMatch(workflow, /benchmark:large/);
});
