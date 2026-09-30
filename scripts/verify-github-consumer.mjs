import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const result = execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    'const { DataEngine } = await import("pipex"); if (typeof DataEngine !== "function") process.exit(1);',
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result, '');
} finally {
  await rm(root, { recursive: true, force: true });
}
