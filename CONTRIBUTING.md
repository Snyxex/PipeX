# Contributing to PipeX

PipeX is a Node.js 22+ TypeScript data-transformation library. Contributions to documentation, tests, bug fixes and focused functionality are welcome under the MIT license. Review [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md) before posting.

## Development setup

Prerequisites: Node.js **22, 24 or 26**, npm and Git. Clone the repository, then run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npm run quality:ci
npm run lint:ci
npm run typecheck:ci
npm run test:examples
```

`quality:ci` includes unit, integration, security, package, consumer, performance and dual-module checks. Run `npm run typecheck:types` if that script is present on your branch, and `node scripts/validate-ai-skills.mjs` when changing AI skill files. For dependencies, assess `npm audit --audit-level=high`. Do not change `package-lock.json` by hand.

## Branches and pull requests

`main` is the protected release-oriented integration branch. Work on a topic branch, for example `feat/stream-telemetry`, `fix/abort-handling`, `docs/getting-started`, `test/stream-regression`, or `chore/dependencies`. Open a PR against `main`. Keep PRs focused, resolve conflicts before review and do not push directly to `main`. Maintainers decide when to merge.

Use **Conventional Commits**, preferably `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `chore:`, or `ci:`; use `!` and a `BREAKING CHANGE:` footer when changing a public contract. Write imperative summaries, e.g. `fix(stream): propagate abort to the source`.

## Design and compatibility

The package exposes both ESM and CommonJS builds and TypeScript declarations. Preserve subpath exports, stream backpressure, cancellation, bounded memory, file-root protections and cryptographic authentication. The binary pack/unpack API is serialization, not encryption. The `dlq` sink is caller-managed and has no implicit persistence or replay. Add regression tests for bug fixes, and update README/API docs and changelog for user-visible changes. Test on the Node.js 22/24/26 matrix when feasible.

## Jenkins and releases

**Jenkins is the only CI system**. Do not add GitHub Actions workflows. The Jenkins pipeline validates the source, lints and typechecks, builds, runs test suites across supported Node versions, audits dependencies and verifies consumer installs. Fork-originated PR code must not run on a credentialed shared build agent without maintainer trust review; use isolated runners for untrusted code.

Only maintainers release. After a reviewed PR merges into `main`, confirm all required Jenkins checks, review `npm pack --dry-run --json --ignore-scripts`, verify package metadata and version uniqueness with the release preflight, review the changelog and then use the separate Jenkins release job with guarded npm credentials. **Never publish from a feature branch or a PR job.** Follow any additional documented approval gate.

## Secrets and disclosure

Never commit `.env` values, `.npmrc` tokens, keys, private certificates, credentials, personal data, real customer payloads or build artifacts. Use generated test keys and sanitized fixtures. Before committing, review `git diff --cached` and run your configured secret scanner (e.g. Gitleaks) against the changes. Ignore rules do **not** remove existing tracked secrets or erase Git history. If credentials were exposed, revoke/rotate them first and contact maintainers privately via [SECURITY.md](SECURITY.md); do not publish the values in a public PR.
