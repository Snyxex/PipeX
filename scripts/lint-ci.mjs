import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|\.npmrc)$/i;
const errors = [];
for (const path of files) {
  if (blocked.test(path)) errors.push('Sensitive file tracked: ' + path);
  if (!/\.(?:ts|js|mjs|cjs|json)$/.test(path) || path.endsWith('package-lock.json')) continue;
  const source = await readFile(path, 'utf8');
  const conflictStart = '<'.repeat(7) + ' ';
  const conflictEnd = '>'.repeat(7) + ' ';
  if (source.includes(conflictStart) || source.includes(conflictEnd)) errors.push('Unresolved merge marker: ' + path);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Repository lint checks passed.');
}
