import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const fixtureUrl = new URL('../consumer/fixtures/github-smoke.mjs', import.meta.url);
const scriptUrl = new URL('../../scripts/verify-github-consumer.mjs', import.meta.url);

test('GitHub installation consumer smoke uses valid ESM import syntax', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  const fixture = await readFile(fixtureUrl, 'utf8');
  assert.match(source, /github-smoke\.mjs/);
  assert.match(fixture, /from '@snyxex\/pipex'/);
  assert.match(fixture, /from '@snyxex\/pipex\/plugins\/kms'/);

  // Parse the same source file that the CI consumer executes after installing.
  // This guards against malformed import() expressions hidden inside JS strings.
  for (const sourceUrl of [scriptUrl, fixtureUrl]) {
    const result = spawnSync(process.execPath,
      ['--check', fileURLToPath(sourceUrl)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
