# Changelog

Changes are documented here for users and downstream maintainers. Versioned releases are also listed under [GitHub Releases](https://github.com/Snyxex/PipeX/releases). This file is not a claim that the package has been published on npm.

## Unreleased

- Maintained Jenkins CI now validates current Node.js 22, 24, and 26 lines.
- Release checks cover package tarballs, clean consumers, a dependency audit, and repository AI-skill validation.
- Added open-source security, contribution, conduct, and release documentation.
- Retired unused Docker-based CI scripts that still referenced Node.js 20.
- Prepared a minimal consumer-facing npm tarball with release metadata and verified packaging tests.

## 1.0.2 — release candidate (not published to npm)

- Prepared the first npm distribution under the scoped name `@snyxex/pipex`; the unrelated unscoped `pipex` package is not this project.
- Kept the Standard Core ESM entrypoint and `@snyxex/pipex/plugins/kms` subpath, and aligned downstream examples and consumer tests.
- Added a protected, read-only release-candidate verification pipeline that audits dependencies, checks Git history, verifies packed consumers and archives the tarball digest.
- Fixed the GitHub dependency consumer smoke test by running a syntax-checked ESM fixture instead of an embedded import expression.
- Publication is pending separate verification and maintainer authorization.

## [1.0.1] - 2026-09-12

- Improved reliability of KMS provider timeout handling.

## [1.0.0] - 2026-09-12

- First stable Standard Core release, including bounded binary, stream and file transformations and security-focused plugin infrastructure.

[1.0.1]: https://github.com/Snyxex/PipeX/releases/tag/v1.0.1
[1.0.0]: https://github.com/Snyxex/PipeX/releases/tag/v1.0.0
