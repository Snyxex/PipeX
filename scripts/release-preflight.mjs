import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const OFFICIAL_REGISTRY = 'https://registry.npmjs.org/';
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SCOPED_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export function checkReleaseSpec(manifest, expectedName, expectedVersion, tags = []) {
  const errors = [];
  if (!SCOPED_NAME.test(manifest.name ?? '')) {
    errors.push('Package name must use a verified npm scope; unscoped "pipex" is owned by another publisher.');
  }
  if (expectedName && manifest.name !== expectedName) {
    errors.push('Expected npm package name does not match package.json.');
  }
  if (!VERSION.test(manifest.version ?? '') || (expectedVersion && manifest.version !== expectedVersion)) {
    errors.push('Expected release version must match a valid package.json version.');
  }
  if (tags.includes('v' + manifest.version)) {
    errors.push('This GitHub version tag already exists; choose an unpublished version.');
  }
  if (manifest.private === true) errors.push('This package is marked private.');
  if (manifest.type !== 'module' || manifest.license !== 'MIT') {
    errors.push('ESM package metadata and MIT license must be retained.');
  }
  if (manifest.engines?.node !== '>=22') errors.push('Node.js engine support must match the tested compatibility contract.');
  if (!manifest.repository?.url?.includes('github.com/Snyxex/PipeX')) {
    errors.push('Source repository metadata is missing.');
  }
  if (!manifest.bugs?.url?.includes('github.com/Snyxex/PipeX')) {
    errors.push('Public bug-reporting metadata is missing.');
  }
  for (const required of ['dist', 'LICENSE', 'README.md', 'CHANGELOG.md']) {
    if (!manifest.files?.includes(required)) errors.push('Missing public tarball entry: ' + required);
  }
  if ((manifest.files ?? []).some(path => path === 'docs' || path.startsWith('.ci') || path.startsWith('test/') || path.includes('jenkins'))) {
    errors.push('Public tarball allowlist contains internal CI or test content.');
  }
  if (manifest.publishConfig?.access !== 'public') {
    errors.push('Scoped public package releases must set publishConfig.access to public.');
  }
  if (manifest.publishConfig?.registry !== OFFICIAL_REGISTRY) {
    errors.push('The publishing registry must be the official npm registry.');
  }
  if (manifest.scripts?.prepublishOnly !== 'npm test') {
    errors.push('Source publish safeguard prepublishOnly must remain enabled.');
  }
  return errors;
}

export async function inspectRegistry(name, version, fetchFn = fetch) {
  if (!SCOPED_NAME.test(name) || !VERSION.test(version)) {
    throw new Error('Invalid scoped release target');
  }
  const url = OFFICIAL_REGISTRY + encodeURIComponent(name);
  const response = await fetchFn(url, {
    headers: { accept: 'application/json', 'user-agent': 'PipeX-release-preflight' },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return { packageExists: false, versionExists: false };
  if (!response.ok) throw new Error('npm registry verification failed (HTTP ' + response.status + ')');
  const metadata = await response.json();
  if (metadata.name !== name) throw new Error('npm registry returned an unexpected package');
  return { packageExists: true, versionExists: Object.hasOwn(metadata.versions ?? {}, version) };
}

function parseOptions(argv) {
  const values = { name: null, version: null, online: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--online') { values.online = true; continue; }
    if ((arg === '--name' || arg === '--version') && argv[i + 1]) {
      values[arg.slice(2)] = argv[++i];
      continue;
    }
    throw new Error('Usage: node scripts/release-preflight.mjs --name @scope/pipex --version 1.0.2 [--online]');
  }
  if (!values.name || !values.version) throw new Error('Expected --name and --version');
  return values;
}

export async function runReleasePreflight(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  const errors = checkReleaseSpec(manifest, options.name, options.version, tags);
  if (errors.length) throw new Error(errors.join('\n'));
  if (options.online) {
    const remote = await inspectRegistry(manifest.name, manifest.version);
    if (remote.versionExists) throw new Error('The selected version already exists on npm.');
    console.log(remote.packageExists ? 'Package exists: independently verify your publishing rights.' :
      'Package absent: verify you control this npm scope before publishing.');
  } else {
    console.log('Offline checks only: npm name ownership and version uniqueness are NOT verified.');
  }
  console.log('Release preflight passed for ' + manifest.name + '@' + manifest.version +
    '. Publication credentials and final artifact approval must still be verified.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleasePreflight().catch(error => {
    console.error(error instanceof Error ? error.message : 'Release preflight failed.');
    process.exitCode = 1;
  });
}
