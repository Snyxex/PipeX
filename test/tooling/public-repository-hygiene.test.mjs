import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const textFiles = [
  'README.md',
  'docs/jenkins.md',
  'docs/npm-release-readiness.md',
  'Jenkinsfile',
];
const sensitivePaths = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/,
  /\.(?:pem|p12|pfx|key|sqlite3?|db)$/i,
  /(?:^|\/)(?:id_rsa|id_ed25519|credentials)(?:\/|$)/i,
];

test('tracked public files exclude local credentials and legacy infrastructure configs', () => {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  const tracked = output.split('\0').filter(Boolean);
  assert.ok(tracked.includes('Jenkinsfile'), 'Project must retain its public CI definition');
  for (const path of tracked) {
    assert.ok(!path.startsWith('.ci/'), 'Obsolete private CI helper must not be tracked: ' + path);
    assert.ok(!sensitivePaths.some(pattern => pattern.test(path)), 'Sensitive local file must not be tracked: ' + path);
  }
});

test('public CI documentation never embeds private Jenkins hosts or personal contact endpoints', async () => {
  for (const path of textFiles) {
    const content = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /https?:\/\/(?:[a-z0-9_.-]*jenkins[a-z0-9_.-]*)\.[a-z]{2,}/i,
      'An operator-specific Jenkins endpoint must not be in ' + path);
    assert.doesNotMatch(content, /\/home\/jenkins(?:-agent)?(?:\/|$)|[A-Z]:\\Users\\/i,
      'An internal agent path must not be in ' + path);
    assert.doesNotMatch(content, /\bnode0[1-9](?:-linux-build)?\b/i,
      'A private hardware node label must not be in ' + path);
    assert.doesNotMatch(content, /[\w.+-]+@(?:gmail|outlook|gmx|web)\.(?:com|de|net)/i,
      'Personal email addresses belong outside public CI docs: ' + path);
  }
});
