# Publishing PipeX to npm

PipeX uses Jenkins for build verification. No normal CI or pull-request job
has npm publication credentials. **The release operation must be deliberately
approved by a maintainer.**

## Critical: confirm the package name

The npm **unscoped** name `pipex` is already listed under an unrelated
publisher (historically `fritzprix`, version `0.0.6`).
That name is **not available** for PipeX unless you independently prove
that your npm account is an authorized maintainer. GitHub repo ownership
does not grant ownership of an npm package.

The selected package name is **`@snyxex/pipex`**, with an intended first scoped release of **`1.0.2`**. Verify the actual npm account controls the `@snyxex` scope before publication. The package metadata, lockfile, imports, and consumer tests have been updated.

From your secure release machine:

```sh
npm config get registry
npm whoami --registry=https://registry.npmjs.org/
npm view pipex name version maintainers --json --registry=https://registry.npmjs.org/
npm view @snyxex/pipex versions --json --registry=https://registry.npmjs.org/
npm access ls-packages
```

Treat npm `E404` as possible package absence, **not** proof you can
publish to that scope. Do not paste authentication tokens or cookies into
issues, logs or chat. Account 2FA/trusted-publishing policies and actual
scope permissions must be checked on the npm account.

The package name and consumer import paths are now scoped. Check the npm account permissions and version availability; a successful HTTP check alone does not grant publishing rights. Keep `DataEngine` APIs stable and do not reuse an already published version.

## Release gates

1. Merge reviewed changes to `main` with green Jenkins tests on Node
   22/24/26, audit, package tests, and clean ESM/TypeScript consumers.
2. Run a full all-refs Git-history scan using a dedicated tool (for example
   `gitleaks`). Read [security history review](security-history-review.md).
   Investigate findings privately and rotate any actual exposed credentials.
3. Confirm package name, publishing rights, registry, 2FA and a **new**
   release version. GitHub already has tags `v1.0.0` and `v1.0.1`;
   tag names must not be reused.
4. Test native file bindings on each operating system claimed to be
   supported. Jenkins currently covers Linux only.
5. Verify release metadata, readme, license, changelog, security policy,
   Node engine requirements and links.
6. Inspect the exact `npm pack --json --ignore-scripts` output; ensure no
   credentials, private CI files or test fixtures are included.
7. Store the tarball's SHA-256, Git SHA, version and contents as protected
   release evidence. Reconfirm that the intended tarball matches the
   reviewed Git commit.
8. Publish **only the inspected tarball** via a protected release
   operation after explicit approval; do not use `npm publish` in PR CI.
9. After publication, install the exact version from the public registry
   in fresh ESM and TypeScript consumers; confirm export paths and digest.
   Publish release notes and send Discord notifications only on confirmed
   successful release events.

## Read-only Jenkins release candidate job

Create a **separate**, permission-restricted Pipeline-from-SCM job
pinned to `main` with Script Path `Jenkinsfile.release-check`.
Only trusted release maintainers may invoke it. It never receives npm
publication tokens and is not a GitHub Actions workflow.

Install a trusted, current `gitleaks` CLI on the release-check agent.
The job fetches all advertised remote branches/tags and runs
`gitleaks git --source . --redact --log-opts='--all'` before it archives
any candidate. A failed or missing scanner **blocks the release check**.
Handle any finding privately; CI logs must never contain actual token values.
A normal clone cannot guarantee coverage of hidden PR refs, removed refs,
forks or unreachable Git objects, so use a dedicated local mirror review
for incident response and any broader historical cleanup.

Supply `PACKAGE_NAME` and `RELEASE_VERSION` parameters matching
`package.json`. The job verifies that the checked-out commit is exactly
the latest `main`, checks existing tags and registry version collisions,
runs quality and audit checks, and archives the candidate tarball with
a SHA-256 digest and contents list. **It does not publish or tag anything.**

Before using this job you must verify the real npm account's scope
permissions. An HTTP 404 or a successful candidate build does not
authorize publication.

The preflight can also be run locally once the manifest has been
migrated to a confirmed scoped package:

```sh
npm run release:preflight -- --name @snyxex/pipex --version 1.0.2 --online
```

The preflight now checks the selected scoped package, the matching release version, and the official registry; a successful check does not by itself establish ownership or approval.

## Why artifact publishing needs a separate test gate

`package.json` currently uses `prepublishOnly: npm test`. That is a useful
safeguard for publishing a working tree, but a tarball publish workflow
must not assume lifecycle tests will rerun. Instead, execute the full
quality/consumer/audit pipeline **before packing**, verify the archive,
then publish exactly that inspected tarball through an approved, protected
publisher.

Never use `npm publish --ignore-scripts` to conceal a failed build.
Do not commit npm tokens or give a shared/untrusted Jenkins worker
access to release credentials.
