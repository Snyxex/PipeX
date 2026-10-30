import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const privateJenkinsUrl = /https?:\/\/(?!(?:[a-z0-9-]+\.)*jenkins\.io(?:[/:?#]|$))[a-z0-9.-]*jenkins[a-z0-9.-]*\.[a-z]{2,}/i;

const baselineTextFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md'];
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

test('official Jenkins documentation is allowed but operator endpoints are rejected', () => {
  assert.doesNotMatch('https://www.jenkins.io/doc/pipeline/steps/credentials-binding/', privateJenkinsUrl);
  assert.doesNotMatch('https://plugins.jenkins.io/', privateJenkinsUrl);
  assert.match('https://jenkins.example.com/job/private', privateJenkinsUrl);
  assert.match('https://jenkins.internal.example.org/', privateJenkinsUrl);
});

test('public CI documentation never embeds private Jenkins hosts or personal contact endpoints', async () => {
  const docs = (await readdir(new URL('../../docs/', import.meta.url)))
    .filter(name => name.endsWith('.md')).map(name => 'docs/' + name);
  const pipelines = (await readdir(new URL('../../', import.meta.url)))
    .filter(name => name.startsWith('Jenkinsfile'));
  const paths = [...baselineTextFiles, ...docs, ...pipelines];
  for (const path of paths) {
    const content = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(content, privateJenkinsUrl,
      'An operator-specific Jenkins endpoint must not be in ' + path);
    assert.doesNotMatch(content, /\/home\/jenkins(?:-agent)?(?:\/|$)|[A-Z]:\\Users\\/i,
      'An internal agent path must not be in ' + path);
    assert.doesNotMatch(content, /\bnode0[1-9](?:-linux-build)?\b/i,
      'A private hardware node label must not be in ' + path);
    assert.doesNotMatch(content, /[\w.+-]+@(?:gmail|outlook|gmx|web)\.(?:com|de|net)/i,
      'Personal email addresses belong outside public CI docs: ' + path);
  }
});
