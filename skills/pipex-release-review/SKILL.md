---
name: pipex-release-review
description: Review PipeX changes for compatibility, security, package correctness, and release readiness without publishing.
---
# PipeX release review

Use when auditing a PipeX change, PR, package artifact, or release candidate.

## Checklist
1. Inspect the exact commit, `package.json`, lockfile, exports, `files` allowlist, and `Jenkinsfile`.
2. Run or request `npm ci --ignore-scripts`, `npm run quality:ci`, and `npm audit --audit-level=high`.
3. Check Node.js 20.19.0, 22, and 24 compatibility on Jenkins; distinguish engine warnings from failures.
4. Inspect `npm pack --dry-run --json` and verify package contents and declaration files.
5. Install the packed tarball in a clean consumer; test root import, `pipex/plugins/kms`, and TypeScript types.
6. Record exact CI build URLs, commit SHAs, unresolved findings, and platform-specific limitations.
7. Consult `docs/npm-release-readiness.md` when present on the checked-out branch.

## Security and publishing
- Never publish, tag, merge, or introduce npm credentials without explicit authorization.
- Avoid executing untrusted PR code on shared Jenkins agents.
- Report observed evidence separately from assumptions and unexecuted checks.
