# npm release readiness (PipeX)

Status: **blocked pending verified CI and package consumer checks**. Do not publish based on this checklist alone.

## Release gates

- [x] Align Jenkins agent label to `linux` (configuration only; build not yet verified).
- [ ] Record the exact commit SHA and successful Jenkins Multibranch build for `main`.
- [ ] Verify `quality:ci` on Node.js 20.19.0, current 22.x, and 24.x.
- [ ] Resolve any engine incompatibilities in the dependency tree; do not assume a successful install implies support.
- [ ] Run `npm audit --audit-level=high` and document any findings.
- [ ] Run `npm pack --dry-run --json`; review the file list for secrets, test fixtures, and accidental source disclosure.
- [ ] Build the tarball using `npm pack --ignore-scripts` after a clean build.
- [ ] In an empty ESM consumer, install the exact tarball and verify `import { DataEngine } from 'pipex'`, `pipex/plugins/kms`, and TypeScript declarations.
- [ ] Verify file-controller native bindings on each platform claimed as supported (at minimum Linux; Windows/macOS only if claimed).
- [ ] Check npm package name availability/ownership and account 2FA or trusted publishing configuration.
- [ ] Confirm license, README install instructions, version, changelog, and release notes.
- [ ] Review active CI workflows and remove deprecated alternatives only after Jenkins checks are proven green.
- [ ] Tag the verified commit and publish the **same** inspected tarball through an explicitly approved release step.
- [ ] Install the published package in a clean consumer and confirm exports and types.

## Suggested local verification

```sh
npm ci --ignore-scripts
npm run quality:ci
npm audit --audit-level=high
npm pack --dry-run --json
mkdir -p .artifacts
npm pack --ignore-scripts --pack-destination .artifacts
```

Do not use `npm publish --ignore-scripts` as a shortcut for bypassing failed prepublish tests. Preserve the current `prepublishOnly` gate or replace it with an equivalent verified artifact-based release procedure.

## Known observations (2026-10-30)

- `package.json` declares `pipex@1.0.1`, ESM exports, `files` allowlist, and `prepublishOnly: npm test`.
- `Jenkinsfile` archives a package but intentionally does not publish.
- README still states npm publication has not occurred.
- Lockfile contains development dependencies with Node engine requirements above the declared minimum; test actual Node 20.19.0 compatibility.
- `./plugins/kms` currently points at the same bundle and declaration file as the root export; verify intended public API in a real consumer.
- The Jenkinsfile previously requested `linux && docker` despite needing no Docker daemon; the agent selector and Jenkins documentation are now aligned to `linux`. Verify the real Jenkins agent has that label.
- No live Jenkins execution, dependency audit, npm ownership check, or cross-platform smoke test has been completed by this document.

## Publication policy

Keep npm credentials out of untrusted PR jobs. Prefer a dedicated, protected release job with explicit approval and minimal publishing permissions. Never commit npm tokens.
