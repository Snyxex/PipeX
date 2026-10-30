# Jenkins CI

PipeX uses the repository-root `Jenkinsfile` for CI. The controller runs on
`jenkins.cloud.snyxe.de`; the existing Jenkins Linux build agent executes
tools through [mise](https://mise.jdx.dev/). No Docker daemon or Docker socket
is required for this pipeline, and the pipeline does not publish packages.

## Connect the repository

The repository is `Snyxex/PipeX` in the **personal Snyxex account**, not
automatically part of the GitHub organization used for Devion.

1. Install the Jenkins GitHub App on the `Snyxex` account and grant access to
   `PipeX`. Installing the app in another organization does not grant access
   to this personal repository.
2. In Jenkins, create a **Multibranch Pipeline** job named `PipeX`.
3. Configure **GitHub** as Branch Source, owner `Snyxex`, repository `PipeX`,
   and choose the appropriate GitHub App credential.
4. Configure the Script Path as `Jenkinsfile`, discover `main` and only
   trusted branches. **Do not enable pull-request builds on the shared host
   agent.** The Jenkinsfile explicitly rejects change-request builds.
5. Configure GitHub webhook delivery to
   `https://jenkins.cloud.snyxe.de/github-webhook/` via the installed app.
   Use webhook events, not frequent polling.
6. Scan repository and run the `main` build. Confirm Jenkins posts its
   build status to GitHub.

Jenkins requires Pipeline, Git, GitHub Branch Source, and artifact archiving
support. The build agent requires Java 25 for remoting, Git, Bash, and
`mise` in the systemd service PATH. The agent must have the label `linux` (the Jenkinsfile deliberately does not require `docker`, because no Docker daemon or socket is used).

## Pipeline gates

Sequential stages run with `mise exec node@...` for:

- Node.js 20.19.0, the declared compatibility minimum.
- The current mise-resolved Node.js 22 release.
- The current mise-resolved Node.js 24 release.
- Blocking `npm audit --audit-level=high` on Node.js 24.
- GitHub dependency consumer smoke test for the checked commit.
- `npm pack` and archive of the tarball and compiled distribution.

Each quality stage runs `npm ci --ignore-scripts --no-audit --no-fund`
followed by `npm run quality:ci`, which covers typecheck, build, tooling,
unit, integration, security, package, consumer, and performance tests.

This intentionally prioritizes compatibility validation over parallelism on
the shared VPS agent. There is a 45-minute build timeout, a 10-minute GitHub
consumer timeout, no concurrent builds for the same branch, 20 retained builds,
and up to 7 days of retained artifacts.

## Security and future improvements

- The shared host agent has no Docker socket. Do not add the agent account to
  the host's `docker` group.
- Only build trusted branches. Use a dedicated isolated/ephemeral agent if
  untrusted pull requests must be tested.
- GitHub App credentials are configured in Jenkins and must not be injected
  into arbitrary build steps. The Jenkinsfile does not request credentials.
- Project versions of Node.js 22 and 24 currently follow the latest minor
  and patch releases within each major. Pin exact versions when strict
  reproducibility is required, and consider a committed `mise.toml`.
- The separate `.ci/jenkins-compose.yml` and
  `.ci/run-jenkins-job.sh` remain from the previous Docker-based design and
  are **not used** by the current Jenkinsfile.
- Do not remove any existing alternative CI until the Jenkins Multibranch
  job succeeds and its GitHub status checks are verified.
- No npm publication or automatic release credentials are configured.
