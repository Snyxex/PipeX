# Contributing to PipeX

Thank you for improving PipeX. This project accepts issue reports, documentation, tests, and focused code contributions under the repository's MIT license.

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md) before contributing. **Never report an undisclosed vulnerability in a public issue or PR.**

## Set up

- Install Node.js **22, 24, or 26** and npm.
- Fork the repository or work in a topic branch; do not commit directly to `main`.
- Install dependencies with `npm ci --ignore-scripts --no-audit --no-fund`.
- Run `npm run quality:ci`; run `node scripts/validate-ai-skills.mjs` if editing `skills/` or agent documentation.
- Run `npm audit --audit-level=high` for dependency changes.
- For changes to file operations or native bindings, document the operating systems you actually tested.

Jenkins uses `mise` to validate the Node.js 22/24/26 matrix. Do not add GitHub Actions workflows. CI green on Linux is **not** proof of compatibility with all operating systems.

## Design and security contract

- PipeX is an ESM data-transformation engine; it is not a durable job queue, scheduler, or transport.
- Public APIs are defined by `src/index.ts` and the package exports. Avoid breaking changes without an explicit migration plan.
- Pack/unpack methods perform serialization only. Do not imply data is encrypted unless an encryption plugin is applied.
- Preserve streaming backpressure, cancellation, resource limits, authenticated decryption, and safe file boundaries.
- Keep caller-owned `dlq` / `setDlq()` failure sinks free of internal persistence or replay.
- Never add secrets, tokens, personal information, real certificates, or private test fixtures.
- Prefer small, reviewable patches, explicit tests, and documentation for changed behavior.

## Pull requests

Describe the problem, the approach, affected public APIs, tests executed, and any residual risks. Include regression tests for bug fixes and security-sensitive behavior. Link related issues when available, and update the changelog for user-visible changes.

CI on the shared Jenkins host is restricted: **fork-originated PRs are not eligible for execution on the shared agent**. Maintainers must review changes to the Jenkinsfile and scripts before trusting them on an agent. External contributions can be reviewed without running untrusted code on the shared host; use an isolated runner when required.

Reviewing a PR does not imply acceptance, publication, or release. Only maintainers approve merges and releases.
