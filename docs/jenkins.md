# Jenkins CI

PipeX uses a repository-root `Jenkinsfile` for continuous integration. The
project runs on Jenkins, not GitHub Actions. Connection details, controller
addresses, agent hostnames, private credentials, and infrastructure topology
belong to the operator's **private** configuration, not this public repository.

## Configuring an installation

1. Configure a **Multibranch Pipeline** for the public `Snyxex/PipeX` repository
   using a Jenkins GitHub App credential with only the required permissions.
2. Set the Script Path to `Jenkinsfile`. Discover `main`, trusted branches and
   same-repository pull requests targeting `main`. Configure PR discovery to
   build PR **heads** (not automatic merge refs): the Jenkinsfile performs its
   own no-commit merge before testing.
3. Configure GitHub webhook delivery to the Jenkins installation's own
   authenticated HTTPS endpoint using **private Jenkins/GitHub settings**.
   Do not check a webhook URL or trigger token into this repository.
4. Provide a trusted Linux agent with the generic `linux` label and `mise`
   installed. Git, Bash and Node.js runtimes must be available. The pipeline
   does not require a Docker socket.
5. Ensure Jenkins status reporting and artifact archiving are configured;
   review any Jenkinsfile changes before allowing execution on a shared host.

## Pipeline gates

The pipeline sequentially validates Node.js 22, 24, and 26 using `mise`:

- `npm ci --ignore-scripts --no-audit --no-fund` and `npm run quality:ci`;
- TypeScript type checks, ESM build, tooling/unit/integration/security tests,
  package and consumer checks, and performance smoke tests;
- `npm audit --audit-level=high`;
- Verified install from a GitHub commit for non-PR branch builds;
- Packed npm artifact and generated TypeScript declarations.

The pipeline is intentionally serial to limit simultaneous resource usage.
Builds have a 45-minute timeout; the GitHub consumer test has a 10-minute
timeout. Up to 20 builds and 7 days of archived artifacts are retained.

## Security

- Treat all code from contributors as untrusted until reviewed. Fork PRs are
  rejected on the shared host; use an isolated runner to test external PRs.
- Even same-repository PR code must not receive publication or Discord webhook
  credentials. Keep them in independently permissioned, `main`-pinned jobs.
- Do not give the build account access to host container sockets or privileged
  infrastructure APIs.
- Branch builds test their head; PR builds first test a prospective merge with
  `main`. A merge conflict fails validation.
- The GitHub dependency consumer stage runs only on branch builds.
- Pin minor/patch runtimes using private operator configuration or a public
  reproducible tool-version manifest when required.
- Ordinary Jenkins CI does not publish npm packages. Publication requires a
  separate, explicitly authorized and protected release workflow.

Public repository documentation must not disclose private Jenkins URL,
physical/virtual host identity, personal contact details, tokens or network
topology. Consult `SECURITY.md` for vulnerability reporting.
