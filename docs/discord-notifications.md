# PipeX CI and release notifications via n8n

PipeX uses **Jenkins for CI** and **n8n for Discord notifications**. Jenkins
does not store or use Discord credentials, and the public repository contains
no internal n8n addresses, webhook URLs or Discord channel IDs.

## Four Discord destinations

| Channel | Source | When |
| --- | --- | --- |
| GitHub releases | GitHub `release` event | Only `published`, never drafts/edits |
| npm releases | Official npm registry | A new `@snyxex/pipex` latest version is observed |
| Pull requests | GitHub `status` event created by Jenkins | Jenkins `pr-head` context reaches success/failure/error |
| Branch builds | GitHub `status` event created by Jenkins | Jenkins `branch` context reaches success/failure/error |

The n8n workflow has an authenticated GitHub trigger for repository
`Snyxex/PipeX`, an hourly npm polling trigger, a deduplication stage,
four-way routing and one Discord send action per destination.

The source GitHub trigger requires permission to create/manage repository
webhooks. The n8n instance must have a working HTTPS webhook URL reachable
by GitHub. Configure the relevant GitHub credential **privately** in n8n.

## Activate only after setup

1. In Discord, create the four text channels. Obtain their **channel IDs** by
   enabling Developer Mode; do not commit IDs or Discord credentials here.
2. In n8n, create a **Discord Bot API** credential and give the bot permission
   to post in those four channels. The workflow references a credential named
   `PipeX Discord Bot` until an actual credential is selected.
3. Replace the four placeholder channel IDs in the Discord nodes.
4. Confirm the GitHub trigger uses a credential with access to
   `Snyxex/PipeX` and events `release` and `status`; check repository
   webhook delivery after publishing.
5. Test with safe example events/pinned data, then activate the workflow.
   Do not publish a real GitHub or npm release solely to test notifications.
6. Jenkins must continue publishing GitHub commit statuses with the exact
   contexts `continuous-integration/jenkins/pr-head` and
   `continuous-integration/jenkins/branch`. Confirm the actual contexts
   in the repository before turning on notifications.

If Jenkins status contexts are renamed, update the n8n GitHub event-normalizer.
PR identification uses the PR number in the Jenkins status target URL
(`PR-123`) when available; otherwise the message links to the commit.
Branch name is best effort, as GitHub commit statuses need not include a
branch name.

## Delivery and security

- The workflow ignores unrelated repositories, pending statuses and unknown
  CI contexts. Failure/error statuses are reported as failures.
- The npm registry poll inspects the `latest` dist-tag. It cannot discover
  versions published only under other dist-tags (for example `next`).
  Existing versions may be announced on the workflow's first live execution;
  seed/clear deduplication state deliberately to avoid that.
- Event IDs are deduplicated across executions in n8n. Its finite stored
  history is **not** a guarantee of exactly-once delivery after retries,
  restoring backups or clearing workflow state.
- All Discord bot credentials remain in n8n, not Jenkins, GitHub, or the
  repository. Never paste a bot token or webhook secret into public files.
- GitHub and npm endpoints may be temporarily unavailable. Inspect n8n
  execution errors if notifications are missing.
- Keep this workflow unpublished until Discord credentials and channel IDs
  are configured and test delivery has been verified.

The former `Jenkinsfile.discord`, `Jenkinsfile.github-release-discord`,
`Jenkinsfile.npm-release-discord`, and
`scripts/notify-discord.mjs` are obsolete and removed.
