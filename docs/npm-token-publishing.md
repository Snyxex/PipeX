# npm token publishing for PipeX

Target: **`@snyxex/pipex@1.0.2`** (first release not yet published).
This guide prepares the workflow; **no npm release is authorized or published by merging these files**.

## Why the first npm release is different

At the latest registry check, `@snyxex/pipex` returned HTTP 404.
npm's `npm stage publish` currently **requires the package to already exist**,
so the first release must be created by an authorized direct publication.
Once `@snyxex/pipex` exists, use stage-only tokens for later releases:
`npm stage publish` + human `npm stage approve` with 2FA.

npm plans to deprecate direct publication with bypass-2FA granular tokens in
**January 2027**. Treat direct token publishing as a first-release bridge,
not a permanent automation design.

## Token requirements for first release

Use a **granular npm access token** belonging to an npm account authorized
to publish to the `@snyxex` scope:

- **Packages and scopes**: limit to `@snyxex` when selectable. Before
  the first package exists, ensure scope selection grants creation rights;
  account ownership and registry permissions must be verified separately.
- **Permissions**: `Read and write (publish and stage)`, **not**
  `Read and write (stage only)` for the first publication.
- **Bypass 2FA**: for unattended token-based direct publishing where
  npm's 2FA requirement applies, enable this **at token creation**.
  A token without the required 2FA capability can fail in Jenkins.
- **Expiration**: keep it short and rotate or revoke after the release.
  Limit allowed IP ranges to the isolated Jenkins agent's *public*
  egress address in CIDR notation if it is fixed and known.
- **Organizations**: personal scope publishing permissions are set under
  packages and scopes; organization-management permissions do not grant
  permission to publish organization-owned packages.

Never put the token in chat, GitHub, a Jenkinsfile, build arguments,
a public environment variable, shell history or Jenkins logs.

## One-time Jenkins setup

1. Provide an **isolated release agent** with label
   `npm-release-isolated`. Do not run credential-bearing jobs on a
   shared PR agent or under the same operating-system account.
2. Create an item- or folder-scoped **Secret text** credential with ID
   `pipex-npm-publish-token` in Jenkins. Paste your newly generated
   npm token into the credential's **Secret** field, *not* into a job
   parameter or repository file.
3. Create a **manually triggered, access-controlled Pipeline from SCM**
   pinned strictly to the protected `main` branch. Script Path:
   `Jenkinsfile.npm-publish`. Do not register this as a multibranch,
   PR-triggered or webhook-triggered publishing job.
4. Restrict who can configure, build and approve this job, who can modify
   protected `main`, and who can access the isolated agent. Jenkins
   credential masking alone does not isolate credentials from other
   same-user processes on the agent.
5. Complete the separate **read-only** `Jenkinsfile.release-check` pipeline before the initial release. The protected publisher independently re-runs security and quality checks, builds the release tarball from the current protected `main` commit and records its SHA-256.

## Run publisher only after release approval

In the protected Jenkins publishing job, use **Build with Parameters**:

| Parameter | Value |
| --- | --- |
| `CONFIRM_RELEASE` | `PUBLISH @snyxex/pipex@1.0.2` |

The protected job checks out the current protected `main` commit and npm registry version, runs full-history Gitleaks, builds and tests the code, audits dependencies and installs the packed tarball in a clean consumer. It calculates and archives the new tarball's SHA-256, and verifies that checksum again immediately before publication. **No commit SHA or checksum needs to be manually entered.** Review the archived artifact, commit and package metadata before approving the in-pipeline publish prompt.

A **manual interactive Jenkins approval** is then required. Only after
approval is the Jenkins Secret text credential bound. The pipeline
writes a temporary private npmrc outside the repository, checks the
tarball SHA again and calls `npm publish` for that tarball.

**No npm token is exposed to the read-only release checker or to
PR/branch builds.** The protected job is deliberately not configured
automatically by this repository change.

After publishing, verify:

```sh
npm view @snyxex/pipex@1.0.2 name version --registry=https://registry.npmjs.org/
npm install @snyxex/pipex@1.0.2
```

Only then prepare an approved GitHub tag and release. n8n will announce
confirmed releases to Discord.

## Later releases: safer staged publishing

For subsequent versions, replace the direct-publish credential with
a `Read and write (stage only)` granular token and use
`npm stage publish <verified-tarball>` in the protected workflow.
A maintainer can inspect the stage using `npm stage view <stage-id>`,
then approve it with `npm stage approve <stage-id>` from an
authenticated terminal (interactive 2FA). Stage-only tokens cannot
directly publish new versions.

References:
- https://docs.npmjs.com/creating-and-viewing-access-tokens/
- https://docs.npmjs.com/about-access-tokens/
- https://docs.npmjs.com/cli/v11/commands/npm-stage/
- https://www.jenkins.io/doc/pipeline/steps/credentials-binding/
