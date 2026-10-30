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

The recommended option is a new **scoped** name, such as
`@snyxex/pipex`, **only if your actual npm account controls that scope**.
Confirm this before renaming the package or publishing.

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

If a scoped name is selected, change `package.json`,
`package-lock.json`, consumer import specifiers, documentation and the
GitHub install tests together; do not only rename the manifest. Keep
`DataEngine` APIs stable. Do not reuse an existing published version.

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

A separate, manually invoked `Jenkinsfile.release-check` can validate
and archive a candidate; it **cannot publish or tag releases**.

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
