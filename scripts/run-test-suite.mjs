import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

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

const reportDir = process.env.PIPEX_JUNIT_DIR;
const reportFile = reportDir ? join(resolve(reportDir), `${basename(inputs[0]).replace(/[^a-z0-9_-]/gi, '-')}.xml`) : undefined;
if (reportFile) await mkdir(resolve(reportDir), { recursive: true });

const result = spawnSync(process.execPath, [
  '--test',
  `--test-concurrency=${concurrency}`,
  `--test-timeout=${timeout}`,
  ...(reportFile ? ['--test-reporter=spec', '--test-reporter=junit', '--test-reporter-destination=stdout', `--test-reporter-destination=${reportFile}`] : []),
  ...files,
], {
  stdio: 'inherit',
  windowsHide: true,
});

// Publish only bounded, redacted diagnostics; full output remains in Jenkins.
if (reportFile) {
  let xml = await readFile(reportFile, 'utf8');
  xml = xml.replace(/<failure\b[^>]*>[\s\S]*?<\/failure>/g, '<failure message="Test failed; see Jenkins for sanitized diagnostic context" />');
  xml = xml.replace(/<failure\b[^>]*\/>/g, '<failure message="Test failed; see Jenkins for sanitized diagnostic context" />');
  xml = xml.replace(/<system-(?:out|err)\b[^>]*>[\s\S]*?<\/system-(?:out|err)>/g, '');
  await writeFile(reportFile, xml);
}
if (result.error) throw result.error;
if (result.signal) console.error(`Test runner terminated by signal ${result.signal}`);
process.exitCode = result.status ?? 1;
