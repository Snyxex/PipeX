import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'npm_execpath is required; run this check through npm');

const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const lockfile = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'));
const typescriptVersion = lockfile.packages['node_modules/typescript'].version;
const nodeTypesVersion = lockfile.packages['node_modules/@types/node'].version;

function run(command, args, cwd, options = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    windowsHide: true,
    ...options,
  });
}

function npm(args, cwd) {
  return run(process.execPath, [
    npmCli,
    ...args,
    '--cache',
    join(repositoryRoot, '.npm'),
  ], cwd);
}

async function writeConsumer(directory) {
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'pipex-external-consumer',
    private: true,
    type: 'module',
  }, null, 2));
  for (const fixture of ['runtime.mjs', 'consumer.ts', 'tsconfig.json']) {
    await cp(
      join(repositoryRoot, 'test', 'consumer', 'fixtures', fixture),
      join(directory, fixture),
    );
  }
}

function installToolingAndPackage(directory, packageSpec, { runScripts = false } = {}) {
  const args = [
    'install',
    '--prefer-offline',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
  ];
  if (runScripts) args.push('--foreground-scripts');
  else args.push('--ignore-scripts');
  args.push(packageSpec, `typescript@${typescriptVersion}`, `@types/node@${nodeTypesVersion}`);
  npm(args, directory);
}

function verifyConsumer(directory) {
  assert.doesNotThrow(() => run(process.execPath, ['runtime.mjs'], directory));
  assert.doesNotThrow(() => run(
    process.execPath,
    [join(directory, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    directory,
  ));
}

test('packed tarball works in a clean runtime and TypeScript consumer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pipex-packed-consumer-'));
  try {
    const packOutput = npm([
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      root,
    ], repositoryRoot);
    const [packed] = JSON.parse(packOutput);
    const tarball = join(root, packed.filename);
    const consumer = join(root, 'consumer');
    await mkdir(consumer);
    await writeConsumer(consumer);
    installToolingAndPackage(consumer, tarball);
    verifyConsumer(consumer);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Git dependency builds missing dist during prepare', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pipex-git-consumer-'));
  try {
    const source = join(root, 'source');
    const consumer = join(root, 'consumer');
    await mkdir(source);
    await mkdir(consumer);
    for (const path of [
      'LICENSE',
      'README.md',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.prod.json',
      'tsdown.config.ts',
      'src',
      'docs',
    ]) {
      await cp(join(repositoryRoot, path), join(source, basename(path)), { recursive: true });
    }
    run('git', ['init', '--quiet'], source);
    run('git', ['-c', 'core.autocrlf=false', 'add', '.'], source);
    run('git', [
      '-c', 'user.name=PipeX CI',
      '-c', 'user.email=ci@pipex.invalid',
      'commit', '--quiet', '-m', 'consumer fixture',
    ], source);

    await writeConsumer(consumer);
    installToolingAndPackage(consumer, `git+${pathToFileURL(source).href}`, { runScripts: true });
    await assert.doesNotReject(() => readFile(join(consumer, 'node_modules/pipex/dist/index.mjs')));
    await assert.doesNotReject(() => readFile(join(consumer, 'node_modules/pipex/dist/index.d.mts')));
    verifyConsumer(consumer);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
