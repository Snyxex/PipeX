---
name: pipex-release-review
description: Review PipeX changes for compatibility, security, package correctness, and release readiness without publishing.
---
# PipeX release review

Use when auditing a PipeX change, PR, package artifact, or release candidate.

## Checklist
1. Inspect the exact commit, `package.json`, lockfile, exports, `files` allowlist, and `Jenkinsfile`.
2. Run or request `npm ci --ignore-scripts`, `npm run quality:ci`, and `npm audit --audit-level=high`.
3. Check Node.js 22, 24 and 26 compatibility on Jenkins; compare with the declared `engines.node` range.
4. Inspect `npm pack --dry-run --json` and verify package contents and declaration files.
5. Install the exact packed candidate in a clean consumer; test root import `@snyxex/pipex`, subpath `@snyxex/pipex/plugins/kms`, and TypeScript types. Also verify GitHub dependency installs.
6. Record exact CI build URLs, commit SHAs, unresolved findings, and platform-specific limitations.
7. Consult `docs/npm-release-readiness.md`, check the scoped npm name `@snyxex/pipex` and unused release tag `v1.0.2`, and verify scope ownership.
8. Review the read-only `Jenkinsfile.release-check` output (Gitleaks scan, SHA-256, archive contents, clean consumer); never infer readiness from an older CI commit.

## Security and publishing
- Never publish, tag, merge, or introduce npm credentials without explicit authorization.
- Avoid executing untrusted PR code on shared Jenkins agents.
- Report observed evidence separately from assumptions and unexecuted checks.
