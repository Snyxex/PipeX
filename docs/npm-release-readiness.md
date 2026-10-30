# npm release readiness (PipeX)

Status (2026-10-30): **`main` CI verified; npm publication still gated**. Do not publish based on this checklist alone.

## Verified on `main`

Evidence: Jenkins successful `main` run for merge commit `36c988755a874f23e085568b999975673b30fb01` (PR #5), completed on 2026-10-30.

- [x] Jenkins Linux agent and `mise` are functioning without a Docker socket.
- [x] Typecheck, build and quality suites pass on Node.js **22.23.3, 24.22.0 and 26.12.0**.
- [x] GitHub dependency and clean tarball consumer checks pass.
- [x] AI-skill validation passes (24 skills and entrypoints).
- [x] `npm audit --audit-level=high` reports 0 vulnerabilities at this commit.
- [x] `npm pack` archives `pipex-1.0.1.tgz`; the test checks built ESM and type exports and the package allowlist.
- [x] Targeted review of 115 `main`-reachable commit diffs and 6 further branch-only commit diffs completed with no high-confidence token/key matches, subject to [documented limits](security-history-review.md).

## Release gates still open

- [ ] Independently run full-history and all-refs secret scanning with a dedicated tool (for example `gitleaks`); review findings privately.
- [ ] Confirm npm registry ownership/availability for `pipex` and the intended publishing identity.
- [ ] Decide the *new* version and avoid collisions with npm releases or existing GitHub tags `v1.0.0` / `v1.0.1`.
- [ ] Validate native bindings and file-system behavior on each OS **claimed** to be supported (Windows/macOS not verified by this Linux Jenkins run).
- [ ] Review the supported minimum Node.js patch level against production dependencies and development/`prepare` requirements; testing current majors alone does not guarantee every older patch.
- [ ] Enable/review GitHub secret scanning, push protection, private vulnerability reporting and branch protection where available.
- [ ] Check license, README, changelog, contact/policy docs and release notes for the actual version.
- [ ] Verify the release tarball digest and content immediately before the protected, explicitly approved publication step.
- [ ] Publish only after approval; then install the published version in a fresh runtime and TypeScript consumer and verify exports/types.

## Execution and ownership

Detailed release steps: [releasing.md](releasing.md). Responsible disclosure: [../SECURITY.md](../SECURITY.md). Git history review: [security-history-review.md](security-history-review.md).

This document records observed CI facts; it is not a guarantee of full supply-chain or cross-platform security. Jenkins never publishes to npm as part of normal CI.
