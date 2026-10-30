# npm release readiness (PipeX)

**Status: release candidate preparation in progress; publication BLOCKED.**
This document separates evidence from prior CI runs from gates that must
pass on the **actual** release commit.

## Evidence from earlier verification

- A Jenkins `main` run succeeded on 2026-10-30 with Node.js
  22.23.3, 24.22.0 and 26.12.0, quality/consumer checks and the
  dependency audit reporting no high-severity vulnerabilities **for
  that earlier commit**.
- The archive task produced a `pipex-1.0.1.tgz` artifact.
- A limited commit-diff review found no high-confidence common
  secret/token matches; see [review limitations](security-history-review.md).

**These observations are not verification of the current `main`
or a future release candidate.** Re-run all relevant gates after
the final package name and version are chosen.

## Current blockers

- [ ] **npm name ownership:** The unscoped name `pipex` has an
      unrelated npm publisher. Confirm control of a new scope
      (for example `@snyxex/pipex`) and migrate the manifest,
      package lock, import paths and consumer tests before release.
- [ ] **Release version:** Select a new version and confirm that
      neither its npm version nor GitHub tag is already published.
- [ ] **Credential controls:** Configure a protected publisher
      and verify actual npm 2FA/trusted publishing/access.
      PR jobs must never receive these credentials.
- [ ] **CI:** Pass Jenkins 22/24/26, audit, package, and
      consumer checks at the final release SHA.
- [ ] **Security:** Complete a full all-refs history scan and
      investigate any matches privately. Verify security settings.
- [ ] **Platforms:** Complete native-binding tests on Windows
      and macOS before claiming support there.
- [ ] **Artifact:** Verify `npm pack --dry-run --json`, then
      archive the **same** tarball, file list and SHA-256.
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
