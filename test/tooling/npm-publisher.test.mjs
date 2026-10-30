import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('npm publishing is isolated, manually approved and absent from normal CI', async () => {
  const publisher = await readFile(new URL('../../Jenkinsfile.npm-publish', import.meta.url), 'utf8');
  const branch = await readFile(new URL('../../Jenkinsfile', import.meta.url), 'utf8');
  const readonly = await readFile(new URL('../../Jenkinsfile.release-check', import.meta.url), 'utf8');

  assert.match(publisher, /agent \{ label 'npm-release-isolated' \}/);
  assert.match(publisher, /checkout scm/);
  assert.match(publisher, /refs\/remotes\/origin\/main/);
  assert.match(publisher, /EXPECTED_COMMIT/);
  assert.match(publisher, /EXPECTED_SHA256/);
  assert.match(publisher, /CONFIRM_RELEASE/);
  assert.match(publisher, /input message:/);
  assert.match(publisher, /sha256sum -c -/);
  assert.match(publisher, /npm publish \.artifacts\/snyxex-pipex-1\.0\.2\.tgz/);
  assert.match(publisher, /withCredentials\(\[string\(credentialsId:/);
  assert.match(publisher, /NPM_CONFIG_USERCONFIG/);
  assert.match(publisher, /trap 'rm -f "\$CONFIG"'/);

  assert.doesNotMatch(branch, /withCredentials|npm publish/);
  assert.doesNotMatch(readonly, /withCredentials|npm publish/);
});
