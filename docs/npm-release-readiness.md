# npm release readiness (PipeX)

**Status: release candidate preparation in progress; publication BLOCKED.**
This document separates evidence from prior CI runs from gates that must
pass on the **actual** release commit.

## Evidence from earlier verification

- A Jenkins `main` run succeeded on 2026-10-30 with Node.js
  22.23.3, 24.22.0 and 26.12.0, quality/consumer checks and the
  dependency audit reporting no high-severity vulnerabilities **for
  that earlier commit**.
- The previous archive task produced an unscoped `pipex-1.0.1.tgz` artifact. It is **not** the new scoped candidate.
- A limited commit-diff review found no high-confidence common
  secret/token matches; see [review limitations](security-history-review.md).

**These observations are not verification of the current `main`
or a future release candidate.** Re-run all relevant gates after
the final package name and version are chosen.

## Current blockers

- [x] **Scoped package migration:** Package metadata, lockfile and public imports use `@snyxex/pipex@1.0.2`.
- [ ] **Publishing permissions:** Verify the npm account owns or is authorized to publish under the `@snyxex` scope.
- [ ] **Release version:** Intended version is `1.0.2`; verify that neither the npm package version nor GitHub tag `v1.0.2` has been published.
- [ ] **Credential controls:** Configure the *separate*, manually
      approved `Jenkinsfile.npm-publish` job on a dedicated
      `npm-release-isolated` agent. Store the granular npm token as an
      item/folder-scoped Jenkins Secret text credential and verify
      `@snyxex` publishing permission, short expiry and required
      bypass-2FA setting. Never provide this token to PR builds.
      See [token publishing](npm-token-publishing.md).
- [ ] **First release:** `@snyxex/pipex` is not on npm yet. Verify that
      `Read and write (publish and stage)` access is available; a
      *stage-only* token cannot create this first npm package because
      npm staging currently requires an existing published package.
- [ ] **CI:** Pass Jenkins 22/24/26, audit, package, and
      consumer checks at the final release SHA. A recent `main` status
      reported a failure; the GitHub consumer smoke test contained an
      invalid embedded import expression. The fix requires a fresh green
      Jenkins run; do not infer that this was the sole CI failure.
- [ ] **Security:** Complete a full all-refs history scan and
      investigate any matches privately. Verify security settings.
- [ ] **Platforms:** Complete native-binding tests on Windows
      and macOS before claiming support there.
- [ ] **Artifact:** Verify `npm pack --dry-run --json`, install the
      **same archived tarball** in a clean consumer, archive its file list
      and SHA-256, and inspect the protected release-check job result.
- [ ] **Publication:** Obtain explicit maintainer approval,
      publish only from a protected job, and check that fresh
      consumers can install the exact package and version.

## Procedure

See [the release runbook](releasing.md) and
[SECURITY.md](../SECURITY.md). Jenkins is the sole CI system and
normal builds do not publish packages.

To examine package contents locally after a successful build:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run quality:ci
npm audit --audit-level=high
npm pack --dry-run --json --ignore-scripts
```

Never infer npm package ownership from GitHub repository ownership or
from an HTTP 404 alone.
