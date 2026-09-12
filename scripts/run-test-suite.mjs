import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputs = [];
let timeout = 15_000;
let concurrency = 1;
let suffix = '.test.mjs';

for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--timeout=')) timeout = Number(argument.slice('--timeout='.length));
  else if (argument.startsWith('--concurrency=')) concurrency = Number(argument.slice('--concurrency='.length));
  else if (argument.startsWith('--suffix=')) suffix = argument.slice('--suffix='.length);
  else inputs.push(argument);
}

if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('Test timeout must be a positive integer');
if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Test concurrency must be a positive integer');
if (!/^\.[a-z-]+\.mjs$/.test(suffix)) throw new Error('Test suffix must identify an MJS test type');
if (inputs.length === 0) throw new Error('At least one test file or directory is required');

async function discover(input) {
  const absolute = resolve(input);
  const entry = await stat(absolute);
  if (entry.isFile()) return absolute.endsWith(suffix) ? [absolute] : [];
  if (!entry.isDirectory()) return [];

  const children = await readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(children
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(child => discover(resolve(absolute, child.name))));
  return nested.flat();
}

const files = [...new Set((await Promise.all(inputs.map(discover))).flat())].sort();
if (files.length === 0) throw new Error(`No *${suffix} files found in: ${inputs.join(', ')}`);

const result = spawnSync(process.execPath, [
  '--test',
  `--test-concurrency=${concurrency}`,
  `--test-timeout=${timeout}`,
  ...files,
], {
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.signal) console.error(`Test runner terminated by signal ${result.signal}`);
process.exitCode = result.status ?? 1;
