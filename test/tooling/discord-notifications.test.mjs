import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildCiPayload, loadGithubRelease, loadNpmRelease, notify, sendDiscord } from '../../scripts/notify-discord.mjs';

const webhook = 'https://discord.com/api/webhooks/1234567890/test_token_ABC';
const sha = 'a'.repeat(40);

test('PR and branch notifications are distinct and do not mention users', () => {
  const base = { CI_RESULT: 'SUCCESS', SOURCE_REF: 'feature/updates', SOURCE_SHA: sha, SOURCE_URL: 'https://jenkins.cloud.snyxe.de/job/pipex/5/', SOURCE_BUILD_NUMBER: '5' };
  const pr = buildCiPayload({ ...base, CI_TARGET: 'pr', PR_NUMBER: '8' });
  const branch = buildCiPayload({ ...base, CI_TARGET: 'branch' });
  assert.match(pr.embeds[0].title, /PR #8/);
  assert.match(branch.embeds[0].title, /Branch feature\/updates/);
  assert.equal(pr.embeds[0].color, 0x2ecc71);
  assert.deepEqual(pr.allowed_mentions, { parse: [] });
  assert.equal(pr.embeds[0].url, base.SOURCE_URL);
});

test('failed and unstable CI builds are visually differentiated, aborted excluded', () => {
  const fail = buildCiPayload({ CI_TARGET: 'branch', CI_RESULT: 'FAILURE', SOURCE_REF: 'main' });
  assert.equal(fail.embeds[0].color, 0xe74c3c);
  assert.equal(buildCiPayload({ CI_TARGET: 'branch', CI_RESULT: 'UNSTABLE' }).embeds[0].color, 0xf1c40f);
  assert.throws(() => buildCiPayload({ CI_TARGET: 'branch', CI_RESULT: 'ABORTED' }));
});

test('PR identifiers and Jenkins links are validated', () => {
  assert.throws(() => buildCiPayload({ CI_TARGET: 'pr', CI_RESULT: 'SUCCESS', PR_NUMBER: '8;rm -rf /' }));
  const result = buildCiPayload({ CI_TARGET: 'branch', CI_RESULT: 'SUCCESS', SOURCE_REF: '@everyone', SOURCE_URL: 'https://example.org/not-jenkins' });
  assert.equal(result.embeds[0].url, undefined);
  assert.deepEqual(result.allowed_mentions, { parse: [] });
});

test('published GitHub release is checked against the GitHub API and event ID', async () => {
  const fetchStub = async url => {
    assert.equal(url, 'https://api.github.com/repos/Snyxex/PipeX/releases/tags/v1.0.2');
    return { ok: true, json: async () => ({ id: 22, tag_name: 'v1.0.2', body: '@everyone changes', draft: false, prerelease: false, published_at: '2026-10-30T21:00:00Z' }) };
  };
  const payload = await loadGithubRelease('v1.0.2', '22', fetchStub);
  assert.match(payload.embeds[0].description, /@everyone/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  await assert.rejects(loadGithubRelease('v1.0.2', '23', fetchStub), /does not match/);
  await assert.rejects(loadGithubRelease('not-valid', '22', fetchStub), /be a version/);
});

test('npm release verification requires exact package and version', async () => {
  const mock = async () => ({ ok: true, json: async () => ({ name: 'pipex', version: '1.0.2' }) });
  const payload = await loadNpmRelease('1.0.2', mock);
  assert.match(payload.embeds[0].title, /pipex@1.0.2/);
  await assert.rejects(loadNpmRelease('v1.0.2', mock), /without a v prefix/);
  await assert.rejects(loadNpmRelease('1.0.2', async () => ({ ok: true, json: async () => ({ name: 'not-pipex', version: '1.0.2' }) })), /another package/);
});

test('outbound Discord requests use the intended webhook and disable mentions', async () => {
  let requests = 0;
  await sendDiscord(buildCiPayload({ CI_TARGET: 'branch', CI_RESULT: 'SUCCESS' }), webhook, async (url, init) => {
    requests++;
    assert.equal(url, webhook);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body).allowed_mentions, { parse: [] });
    return { ok: true };
  });
  assert.equal(requests, 1);
  await assert.rejects(sendDiscord({ embeds: [{}] }, 'https://attacker.example/api/webhooks/1/token'), /Invalid Discord webhook/);
  await assert.rejects(sendDiscord({ embeds: [{}] }, webhook, async () => ({ ok: false, status: 429 })), /HTTP 429/);
});

test('notification CLI selects its CI channel without accessing external release APIs', async () => {
  const calls = [];
  await notify({ DISCORD_EVENT_KIND: 'ci', DISCORD_WEBHOOK_URL: webhook, CI_TARGET: 'pr', CI_RESULT: 'FAILURE', PR_NUMBER: '8' }, async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, webhook);
});

test('GitHub release notifier rejects unrelated webhook actions and repositories', async () => {
  await assert.rejects(notify({ DISCORD_EVENT_KIND: 'github-release', GH_ACTION: 'edited', GH_REPO: 'Snyxex/PipeX' }), /Not a published/);
  await assert.rejects(notify({ DISCORD_EVENT_KIND: 'github-release', GH_ACTION: 'published', GH_REPO: 'another/repo' }), /Not a published/);
});

test('Discord webhook credentials stay outside the untrusted PR/branch Jenkinsfile', async () => {
  const read = async path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
  const ci = await read('Jenkinsfile');
  const notifier = await read('Jenkinsfile.discord');
  const release = await read('Jenkinsfile.github-release-discord');

  assert.match(ci, /PipeX-Discord-Notifier/);
  assert.match(ci, /wait: false/);
  assert.match(ci, /currentBuild\.currentResult/);
  assert.doesNotMatch(ci, /withCredentials|DISCORD_WEBHOOK_URL/);
  assert.match(notifier, /withCredentials/);
  assert.match(notifier, /pipex-discord-pr-ci/);
  assert.match(notifier, /pipex-discord-branch-ci/);
  assert.match(notifier, /pipex-discord-npm-release/);
  assert.match(notifier, /git merge-base --is-ancestor HEAD/);
  assert.match(release, /GenericTrigger/);
  assert.match(release, /pipex-discord-github-release/);
  assert.match(release, /tokenCredentialId: 'pipex-github-release-trigger-token'/);
  assert.match(release, /git merge-base --is-ancestor HEAD/);
});
