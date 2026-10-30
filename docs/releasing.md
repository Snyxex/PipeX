# Release procedure

PipeX CI runs on **Jenkins**. A green Jenkins build verifies code and packages; it does **not** publish to npm or approve a release.

## Before tagging

1. Select a reviewed `main` commit with passing Jenkins Node.js 22, 24 and 26 stages, AI-skill validation, dependency audit, package/consumer tests and archived tarball.
2. Verify the intended package name `pipex` and ownership with the real npm registry and the publishing account. **This has not yet been independently confirmed.** If unavailable, choose an approved scoped name and update exports/docs accordingly.
3. Review the release version and compare it with existing npm versions and GitHub tags. GitHub already has `v1.0.0` and `v1.0.1` releases; do not reuse an existing published version or retag a historical release.
4. Confirm supported operating systems. Jenkins currently provides Linux coverage; native file operations need explicit Windows/macOS tests before claiming platform support.
5. Run a dedicated full-history secret scan as described in [security-history-review.md](security-history-review.md), investigate findings and rotate any exposed credentials.
6. Confirm [SECURITY.md](../SECURITY.md), [CONTRIBUTING.md](../CONTRIBUTING.md), license, README installation instructions and changelog reflect the release. Check required repository security settings.
7. Inspect `npm pack --dry-run --json` for unintended files and check the final tarball against the public package allowlist.

## Publication controls

- Never publish from a pull request, a shared untrusted executor, or an ordinary `main` build.
- Only an explicitly approved, protected release operation may publish. Keep npm credentials in a restricted secrets store; use supported trusted publishing / 2FA where configured.
- Publish **the exact reviewed artifact** (by path and digest), not a rebuild from a different commit. Check the npm account and registry destination before using `npm publish`.
- No `npm publish`, tag creation, or GitHub Release mutation is automated by this repository.
- After publication, verify the exact package and version from a fresh consumer install, imports/types, metadata, provenance where configured, and package contents.

A successful `npm pack` proves an artifact can be created; it does not establish that the package name is available or that publication is authorized.
