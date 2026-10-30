import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm so npm_execpath is available');
const root = await mkdtemp(join(tmpdir(), 'pipex-packed-consumer-'));
const artifacts = resolve('.artifacts');
try {
  const tarballs = (await readdir(artifacts)).filter(name => /^pipex-.*\.tgz$/.test(name));
  assert.equal(tarballs.length, 1, 'Expected exactly one PipeX tarball in .artifacts');
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'pipex-packed-consumer', private: true, type: 'module'
  }));
  execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit',
    '--no-fund', '--package-lock=false', join(artifacts, tarballs[0])], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['--input-type=module', '--eval',
    'import { DataEngine } from "pipex"; import { KmsEncryptionPlugin } from "pipex/plugins/kms"; if (typeof DataEngine !== "function" || typeof KmsEncryptionPlugin !== "function") process.exit(1);'
  ], { cwd: root, stdio: 'inherit' });
} finally {
  await rm(root, { recursive: true, force: true });
}
