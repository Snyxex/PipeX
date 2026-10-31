/**
 * Print the exact files npm would publish, and an indicative JS module footprint.
 * Run after 'npm run build'. The entry footprint is a static import graph and
 * is not a measurement of external dependencies, download size or memory use.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const cwd = process.cwd();
const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
const raw = execFileSync(process.execPath, [process.env.npm_execpath ?? resolve('node_modules/npm/bin/npm-cli.js'), ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const start = raw.indexOf('[{');
if (start < 0) throw new Error('npm pack did not produce a JSON array');
const [pack] = JSON.parse(raw.slice(start));
if (!pack || !Array.isArray(pack.files)) throw new Error('Invalid npm pack metadata');
const bytes = n => (n / 1024).toFixed(1) + ' KiB';
const all = [...pack.files].sort((a, b) => a.path.localeCompare(b.path));
const rows = all.map(f => '| `' + f.path + '` | ' + f.size + ' | ' + bytes(f.size) + ' |');
const forbidden = all.filter(f => /(^|\/)(?:src|test|tests|scripts|config)(\/|$)|\.map$|(^|\/)Jenkinsfile/i.test(f.path));
if (forbidden.length) throw new Error('Unexpected files in npm pack: ' + forbidden.map(x => x.path).join(', '));
const entrypointNames = {
  'Core (DataEngine + existing API)': 'dist/index.mjs',
  'Compression only': 'dist/compression.mjs',
  'Encryption only': 'dist/encryption.mjs',
  'Full pipeline (root import)': 'dist/index.mjs',
};
const jsFiles = new Map(all.filter(f => /\.(mjs|cjs)$/.test(f.path)).map(f => [f.path, f.size]));
const visit = async (file, seen = new Set()) => {
  if (seen.has(file) || !jsFiles.has(file)) return seen;
  seen.add(file);
  const source = await readFile(resolve(cwd, file), 'utf8');
  const imports = [...source.matchAll(/(?:from\s*|import\s*\(|import\s*|require\s*\()\s*['"]([^'"]+)['"]/g)];
  for (const [, target] of imports) {
    if (!target.startsWith('.')) continue;
    const child = resolve(dirname(resolve(cwd, file)), target);
    const relative = child.slice(cwd.length + 1).replaceAll('\\', '/');
    if (jsFiles.has(relative)) await visit(relative, seen);
  }
  return seen;
};
const footprints = [];
for (const [name, entry] of Object.entries(entrypointNames)) {
  if (!existsSync(resolve(cwd, entry))) continue;
  const refs = await visit(entry);
  const size = [...refs].reduce((sum, file) => sum + jsFiles.get(file), 0);
  footprints.push('| ' + name + ' | ' + bytes(size) + ' | ' + refs.size + ' |');
}
const total = all.reduce((sum, f) => sum + f.size, 0);
const maps = all.filter(x => x.path.endsWith('.map')).reduce((sum, f) => sum + f.size, 0);
const text = [
  '# PipeX npm bundle-size report',
  '',
  'Generated using `npm pack --dry-run --json --ignore-scripts`.',
  '',
  '- Package: `' + pack.name + '@' + pack.version + '`',
  '- Total unpacked: **' + bytes(total) + '** (' + total + ' bytes)',
  '- Tarball size: **' + bytes(pack.size ?? 0) + '** (npm estimate)',
  '- Entries: **' + all.length + '**',
  '- Source maps: **' + bytes(maps) + '**',
  '',
  '## All published files',
  '',
  '| File | Bytes | Size |',
  '| --- | ---: | ---: |',
  ...rows,
  '',
  '## Static JavaScript entry footprints (ESM, excluding external dependencies)',
  '',
  '| Scenario | JS footprint | Referenced JS chunks |',
  '| --- | ---: | ---: |',
  ...footprints,
  '',
  '> The current root export contains all registered plugins. The core and full-pipeline scenarios therefore reference the same entry point; this is NOT yet a separately lightweight core build. Static imports are approximate and cannot account for all bundler/runtime behavior.',
  '',
].join('\n');
await writeFile('bundle-size-report.md', text);
process.stdout.write(text);
