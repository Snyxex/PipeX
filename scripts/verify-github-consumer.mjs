import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npmCli = process.env.npm_execpath;
const packageSpec = process.env.PIPEX_GITHUB_INSTALL_SPEC;

assert.ok(npmCli, 'npm_execpath is required; run this check through npm');
assert.match(
  packageSpec ?? '',
  /^github:Snyxex\/PipeX#(?:[0-9a-f]{40}|refs\/pull\/[0-9]+\/head)$/,
  'PIPEX_GITHUB_INSTALL_SPEC must target the checked commit or pull-request head',
);

const root = await mkdtemp(join(tmpdir(), 'pipex-github-consumer-'));
try {
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'pipex-github-consumer-smoke',
    private: true,
    type: 'module',
  }, null, 2));
  // Store executable ESM separately so `node --check` covers the consumer import.
  // A missing parenthesis in an embedded --eval string previously broke this smoke test.
  await copyFile(new URL('../test/consumer/fixtures/github-smoke.mjs', import.meta.url),
    join(root, 'github-smoke.mjs'));
  execFileSync(process.execPath, [
    npmCli,
    'install',
    '--prefer-offline',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--foreground-scripts',
    '--cache',
    resolve('.npm'),
    packageSpec,
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const result = execFileSync(process.execPath, ['github-smoke.mjs'], {
    cwd: root, encoding: 'utf8', stdio: 'pipe',
  });
  assert.equal(result, '');
} finally {
  await rm(root, { recursive: true, force: true });
}
