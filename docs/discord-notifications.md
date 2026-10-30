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

The four Discord channels already have incoming webhooks. No Discord bot
or numeric channel IDs are needed. Each webhook targets a particular channel.

1. Open the n8n workflow and one of the four `Discord · …` nodes.
2. Select **Authentication: Webhook** and **Send a Message**.
   The message expression `{{ $json.message }}` is preconfigured.
3. Under **Credential for Discord Webhook**, create a new **Discord
   Webhook** credential. Paste the existing webhook URL from the matching
   Discord channel. Make one credential for each of the four channels.
4. Save and test each destination with harmless sample messages before
   publishing the workflow.
5. Confirm the n8n GitHub trigger has permission to register `release`
   and `status` webhooks in `Snyxex/PipeX`, and that its HTTPS endpoint
   is externally reachable.
6. Publish the workflow only after the credentials and routes work.
7. Jenkins must publish the actual commit statuses using
   `continuous-integration/jenkins/pr-head` and
   `continuous-integration/jenkins/branch` contexts.

### Credentials and destinations

| n8n sender | Existing webhook URL to store in its Discord credential |
| --- | --- |
| `Discord · GitHub Releases` | Webhook for GitHub release announcements |
| `Discord · npm Releases` | Webhook for npm releases |
| `Discord · PR CI` | Webhook for PR build results |
| `Discord · Branch CI` | Webhook for branch build results |

Webhook URLs are secrets. They belong **only in Discord Webhook
credentials in n8n**, not in public repository files, regular workflow
fields, logs or chat messages.

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
- All Discord webhook URLs stay in n8n credentials, not Jenkins, GitHub, or the
  repository. Do not paste webhook secrets into public files.
- GitHub and npm endpoints may be temporarily unavailable. Inspect n8n
  execution errors if notifications are missing.
- Keep this workflow unpublished until the four Discord webhook credentials
  are configured and test delivery has been verified.

The former `Jenkinsfile.discord`, `Jenkinsfile.github-release-discord`,
`Jenkinsfile.npm-release-discord`, and
`scripts/notify-discord.mjs` are obsolete and removed.
