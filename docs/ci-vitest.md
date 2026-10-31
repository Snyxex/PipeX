# Jenkins CI and Vitest migration

The original Node.js `node:test` suites remain authoritative while Vitest tests are migrated. No GitHub Actions are used.

## Test tools

- `npm run lint:ci`: secret-file and merge-conflict checks
- `npm run typecheck:ci`: public API compile-time checks including negative `@ts-expect-error` cases
- `npm run test:vitest`: Vitest unit/integration suites in `test/vitest`
- `npm run coverage:vitest`: V8 coverage over `src/core` and `src/plugin` (the current transform implementation location), minimum lines/statements 70%, functions 65%, branches 60%
- `npm run quality:ci`: existing comprehensive Node suite and consumers
- `npm pack --dry-run --ignore-scripts`: verify package contents after build

**Dependency lock:** Before enabling Vitest in required Jenkins stages, regenerate and commit `package-lock.json` using `npm install --package-lock-only --save-dev vitest @vitest/coverage-v8`, then run `npm ci` and `npm run coverage:vitest`. Do not enable a new required stage while `npm ci` cannot resolve its lockfile. The Vitest scripts intentionally remain optional in the first migration commit.

## Jenkins release job

Use `Jenkinsfile.github-release` as a dedicated **trusted** job triggered by an authenticated GitHub Release webhook. Jenkins must validate the webhook and confirm that the release is published (not draft or prerelease), that the tag points to a reviewed commit on the protected main branch, and that the tag is immutable. The pipeline refuses PR-triggered publication and asks for explicit maintainer approval. Configure the credential ID `pipex-npm-release-token` only in that job. Ordinary Jenkins PR/branch jobs receive no npm credentials.

Never echo secrets, upload environment files, or archive npm credentials; token handling uses a temporary restricted npmrc. The job must be restricted to trusted maintainers and an isolated release agent.
