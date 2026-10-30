# PipeX: Jenkins -> Discord notifications

PipeX routes **four types of events to four Discord channels**, using four distinct Discord webhooks. Discord notification credentials are **never available to the PR or branch CI pipeline**. Jenkins is the notification sender; no GitHub Actions or n8n are required.

## Channels and credentials

Create four text channels in your Discord server (suggested names below). In each channel, go to **Edit Channel -> Integrations -> Webhooks -> New Webhook**, then copy the URL.

Create **Secret text** credentials in Jenkins at **Manage Jenkins -> Credentials**, with IDs matching exactly:

| Discord channel (example) | Jenkins Secret text ID | Message source |
| --- | --- | --- |
| `#github-releases` | `pipex-discord-github-release` | GitHub Release event with action `published` |
| `#npm-releases` | `pipex-discord-npm-release` | Protected Jenkins npm-publish job, **after publication succeeds** |
| `#pr-builds` | `pipex-discord-pr-ci` | Jenkins same-repository PR build: SUCCESS / FAILURE / UNSTABLE |
| `#branch-builds` | `pipex-discord-branch-ci` | Jenkins branch build: SUCCESS / FAILURE / UNSTABLE |

Use unmodified URLs of the form `https://discord.com/api/webhooks/<id>/<token>`, with **no query string**. Do **not** put webhook URLs in source control, PR descriptions, Jenkins build parameters, or command-line arguments. Treat a leaked webhook URL as compromised and regenerate it.

Also create a separate, randomly generated Jenkins **Secret text** credential `pipex-github-release-trigger-token` for the GitHub release webhook receiver. It is **not** a Discord webhook URL.

## Job 1: trusted PR and branch CI notifier

Create a **standalone Pipeline-from-SCM** job in your private Jenkins installation using the PipeX repository, branch **`main` only**, and Script Path **`Jenkinsfile.discord`**. Do not use Multibranch or a PR head for this job. Set the non-secret environment variable **`PIPEX_DISCORD_CI_JOB`** in the CI job configuration to the full name of this trusted notifier job. Keep its full Jenkins folder path and controller hostname in private Jenkins settings, not the repository.

Restrict Job/Configure and Job/Build permissions; limit its SCM configuration and scripts to reviewed `main`. The job runs on the trusted `linux` agent using Node.js 24 via `mise`. Run it **once**, selecting the default `bootstrap` event: this checks out the trusted script and **sends nothing**.

Once `PIPEX_DISCORD_CI_JOB` is configured, the ordinary `Jenkinsfile` queues this job asynchronously for SUCCESS, FAILURE, and UNSTABLE CI results. It sends `CI_TARGET=pr` for PR builds (based on `CHANGE_ID`) and `CI_TARGET=branch` for branch builds. It does not notify on ABORTED. The notifier reads the matching Discord credential and sends an embed containing the result, source ref and a **public GitHub PR/commit link**; it never exposes internal Jenkins build URLs.

**CI does not fail merely because the notifier job is missing or unavailable.** The notifier has its own failed build if Discord rejects delivery; monitor it separately. The normal CI pipeline does not call `withCredentials`.

## Job 2: protected npm release notifier

Create another standalone **Pipeline-from-SCM** job in your private Jenkins installation on `main` with Script Path **`Jenkinsfile.npm-release-discord`**. Set `PIPEX_DISCORD_NPM_JOB` to that job's full name **only inside the protected publisher's Jenkins configuration**, never in an untrusted PR build. Restrict **Job/Build** permissions to release maintainers and the protected publishing job: ordinary PR/branch CI must **not** be allowed to trigger this job. Its initial build with an empty `RELEASE_VERSION` is a bootstrap and sends nothing.

The repository's ordinary CI does **not** publish to npm. Once you have an approved **protected npm-publish job**, queue a notification only **after `npm publish` succeeds** and the exact package version has been confirmed. For example, from that trusted release job:

~~~groovy
build job: env.PIPEX_DISCORD_NPM_JOB,
  parameters: [
    string(name: 'RELEASE_VERSION', value: env.RELEASE_VERSION)
  ],
  wait: false,
  propagate: false
~~~

The protected publisher must verify that `PIPEX_DISCORD_NPM_JOB` is configured before queueing the notification. The notifier independently checks that `https://registry.npmjs.org/pipex/<version>` reports the exact package and version. It is not proof of package ownership or release approval: verify `pipex` ownership before adding any publication credentials. Avoid running this from PRs or generic branch jobs.

A manually published npm package outside Jenkins is **not** automatically detected by this integration. To cover external publishers, add an approved registry event source or polling workflow with durable deduplication.

## Job 3: GitHub published-release notifier

This job sends the GitHub Release channel notification when a release is **published on GitHub**, independently of npm publication. It also covers releases published manually on the GitHub website.

1. Install the **Generic Webhook Trigger** plugin in Jenkins (use a current, patched version compatible with the controller).
2. Create another **standalone Pipeline-from-SCM** job using an operator-chosen private Jenkins job name, pinned to the PipeX repository's **`main`** branch with Script Path **`Jenkinsfile.github-release-discord`**.
3. Create a Jenkins Secret text credential `pipex-github-release-trigger-token`, holding a long random value. Its ID is referenced in the Jenkinsfile's `tokenCredentialId`.
4. Run this Jenkins job once to install the webhook trigger configuration. Its first run (with no published release payload) **must not send a notification**.
5. In GitHub, open **Snyxex/PipeX -> Settings -> Webhooks -> Add webhook**, configure the payload URL using your **privately configured** HTTPS Jenkins controller address plus `/generic-webhook-trigger/invoke?token=<the-random-trigger-token>`, Content type **application/json**, and subscribe to **Releases** events only. Use HTTPS. Treat the URL and token as sensitive.
6. Test with a **new test release only if authorized**, or with an authenticated controlled webhook test in a safe environment. Do not create or publish a real release solely to test notifications without permission.

The trigger extracts `$.action`, `$.repository.full_name`, `$.release.tag_name`, and `$.release.id` from the GitHub webhook. Only `published` events for `Snyxex/PipeX` run the sending stage. The notifier re-fetches the release from GitHub's API and verifies the release ID, tag, published state and release notes before forwarding. Drafts, edits and deletions are ignored.

This receiver uses a protected trigger token and validates against GitHub's public API; it does **not** independently validate GitHub's `X-Hub-Signature-256` HMAC. Restrict webhook endpoint exposure and Jenkins permissions accordingly. A dedicated GitHub-signature-validating gateway is stronger when required.

## Security and operating limits

- A user with write access to a repository-controlled Jenkinsfile can change a PR pipeline. Thus **do not bind Discord secrets in the PR or branch job**. All three separate notifier jobs must fetch trusted `main` code and must not accept a dynamic SCM branch.
- The Discord sender uses `allowed_mentions: { parse: [] }` to disable mass mentions, restricts the outgoing webhook host to `discord.com`, and truncates event-supplied content. It never prints webhook URLs or HTTP response bodies.
- GitHub releases require semver-style tags; npm versions must use the exact version without a `v` prefix.
- **Delivery is best effort**: Discord can return HTTP errors or time out. The notifier fails visibly without altering CI status. Build/script syntax errors occurring before Jenkins can initialize the CI pipeline cannot trigger the pipeline's `post` section.
- Jenkins webhooks or manual release job reruns may deliver duplicate notifications. There is **no guaranteed exactly-once deduplication** in this first implementation. If exactly-once delivery is important, add a durable event-ID store and reconciliation.
- Never grant PRs access to protected release credentials. Keep the npm and GitHub Release notifier jobs on a trusted agent with minimal credentials. Follow the [npm release readiness checklist](npm-release-readiness.md) and [enterprise security guidance](enterprise.md).

## Local tests

~~~bash
node --test test/tooling/discord-notifications.test.mjs
npm run test:tooling
~~~

The tests stub HTTP requests and must not send real Discord messages. All three notification jobs require Jenkins-side job creation and credentials before end-to-end verification.
