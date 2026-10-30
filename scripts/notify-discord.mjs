import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const COLORS = Object.freeze({ SUCCESS: 0x2ecc71, FAILURE: 0xe74c3c, UNSTABLE: 0xf1c40f });
const DISCORD_WEBHOOK = /^https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/;
const GITHUB_RELEASE_API = 'https://api.github.com/repos/Snyxex/PipeX/releases/tags/';
const NPM_PACKAGE_API = 'https://registry.npmjs.org/pipex/';

function field(value, max = 100) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function safeJenkinsUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' || url.hostname !== 'jenkins.cloud.snyxe.de' || url.username || url.password) return undefined;
    return url.href.slice(0, 500);
  } catch {
    return undefined;
  }
}

function safeTag(value) {
  const tag = field(value, 100);
  if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error('Release tag must be a version such as v1.2.3');
  }
  return tag;
}

function safeNpmVersion(value) {
  const version = field(value, 100);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('npm version must be a version without a v prefix');
  }
  return version;
}

function safeSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value ?? '')) ? String(value).slice(0, 12) : 'unknown';
}

function releaseDescription(text, max = 1900) {
  return field(text || 'See the release page for details.', max) || 'See the release page for details.';
}

export function buildCiPayload(env) {
  const target = env.CI_TARGET;
  const result = env.CI_RESULT;
  if (!['pr', 'branch'].includes(target)) throw new Error('Unknown CI target');
  if (!Object.hasOwn(COLORS, result)) throw new Error('Unknown CI result');

  const ref = field(env.SOURCE_REF, 100) || 'unknown';
  const runUrl = safeJenkinsUrl(env.SOURCE_URL);
  const buildNo = field(env.SOURCE_BUILD_NUMBER, 16);
  const sha = safeSha(env.SOURCE_SHA);
  const prNumber = field(env.PR_NUMBER, 16);
  if (target === 'pr' && !/^[1-9][0-9]*$/.test(prNumber)) throw new Error('Missing valid PR number');

  const subject = target === 'pr' ? 'PR #' + prNumber : 'Branch ' + ref;
  const title = (result === 'SUCCESS' ? 'PASSED' : result) + ' · ' + subject;
  const info = [
    { name: 'Result', value: result, inline: true },
    { name: 'Source', value: ref, inline: true },
    { name: 'Commit', value: sha, inline: true },
  ];
  if (buildNo) info.push({ name: 'Jenkins build', value: '#' + buildNo, inline: true });
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: field(title, 250),
      description: 'PipeX ' + (target === 'pr' ? 'pull request' : 'branch') + ' build completed.',
      color: COLORS[result],
      ...(runUrl ? { url: runUrl } : {}),
      fields: info,
      footer: { text: 'PipeX · Jenkins CI' },
    }],
  };
}

export async function loadGithubRelease(tagValue, idValue, fetchImpl = fetch) {
  const tag = safeTag(tagValue);
  const eventId = field(idValue, 24);
  if (!/^[1-9][0-9]*$/.test(eventId)) throw new Error('GitHub release event is missing a valid release ID');
  const response = await fetchImpl(GITHUB_RELEASE_API + encodeURIComponent(tag), {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'PipeX-Jenkins-Discord' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('GitHub release verification failed (HTTP ' + response.status + ')');
  const data = await response.json();
  if (String(data.id) !== eventId || data.tag_name !== tag || data.draft || !data.published_at) {
    throw new Error('GitHub release event does not match a published release');
  }
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: field('GitHub Release · ' + tag, 250),
      description: releaseDescription(data.body),
      url: 'https://github.com/Snyxex/PipeX/releases/tag/' + encodeURIComponent(tag),
      color: 0x5865f2,
      fields: [{ name: 'Type', value: data.prerelease ? 'Pre-release' : 'Stable', inline: true }],
      footer: { text: 'PipeX · GitHub Releases' },
    }],
  };
}

export async function loadNpmRelease(versionValue, fetchImpl = fetch) {
  const version = safeNpmVersion(versionValue);
  const response = await fetchImpl(NPM_PACKAGE_API + encodeURIComponent(version), {
    headers: { accept: 'application/json', 'user-agent': 'PipeX-Jenkins-Discord' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('npm release verification failed (HTTP ' + response.status + ')');
  const data = await response.json();
  if (data.name !== 'pipex' || data.version !== version) throw new Error('npm registry returned another package/version');
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: field('npm Release · pipex@' + version, 250),
      description: 'PipeX ' + version + ' is available from the npm registry.\n\nInstall: npm install pipex@' + version,
      url: 'https://www.npmjs.com/package/pipex/v/' + encodeURIComponent(version),
      color: 0xcb3837,
      footer: { text: 'PipeX · npm Registry' },
    }],
  };
}

export async function sendDiscord(payload, url, fetchImpl = fetch) {
  if (!DISCORD_WEBHOOK.test(String(url ?? ''))) throw new Error('Invalid Discord webhook credential URL');
  if (!Array.isArray(payload?.embeds) || payload.embeds.length !== 1) throw new Error('Invalid Discord message');
  if (JSON.stringify(payload).length > 5500) throw new Error('Discord message is too large');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Discord notification failed (HTTP ' + response.status + ')');
}

export async function notify(env = process.env, fetchImpl = fetch) {
  let payload;
  if (env.DISCORD_EVENT_KIND === 'ci') {
    payload = buildCiPayload(env);
  } else if (env.DISCORD_EVENT_KIND === 'github-release') {
    if (env.GH_ACTION !== 'published' || env.GH_REPO !== 'Snyxex/PipeX') {
      throw new Error('Not a published PipeX GitHub release event');
    }
    payload = await loadGithubRelease(env.RELEASE_TAG, env.GH_RELEASE_ID, fetchImpl);
  } else if (env.DISCORD_EVENT_KIND === 'npm-release') {
    payload = await loadNpmRelease(env.RELEASE_VERSION, fetchImpl);
  } else {
    throw new Error('Unsupported notification event');
  }
  await sendDiscord(payload, env.DISCORD_WEBHOOK_URL, fetchImpl);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  notify().then(
    () => console.log('Discord notification accepted.'),
    error => {
      // No webhook URL, response body, or credentials may be printed to logs.
      console.error(field(error instanceof Error ? error.message : 'Discord notification failed', 250));
      process.exitCode = 1;
    },
  );
}
