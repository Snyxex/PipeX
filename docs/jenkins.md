# Jenkins CI

`Jenkinsfile` is the proposed authoritative Jenkins definition for PipeX. It is
safe to use in a Multibranch Pipeline and does not publish packages or load
release credentials. The existing GitHub Actions workflow remains enabled until
the first Jenkins build for this revision is green; removing it before then
would create an unverified CI transition.

## Required Jenkins setup

Create a **Multibranch Pipeline** for `https://github.com/Snyxex/PipeX.git`
with script path `Jenkinsfile`. Discover `main` and pull requests, and configure
the GitHub webhook as the primary trigger for pushes and pull requests. Do not
use periodic polling as the normal trigger.

The required plugins are Pipeline, Git, and GitHub Branch Source. No Docker
Pipeline or Credentials Binding plugin is required because the pipeline invokes
the agent's Docker Compose v2 CLI and uses no credentials. Repository access may
use a read-only checkout credential if the repository is made private; it must
not be exposed to untrusted pull-request build steps. Configure branch discovery
to exclude fork pull requests. The Jenkinsfile rejects a detected `CHANGE_FORK`
as defense in depth before any container is started.

The selected agent has label `docker-vps` and needs Bash, Git, Docker, Docker
Compose v2, and permission to run Docker. Docker access is privileged: dedicate
this agent to trusted builds where possible, restrict who can configure jobs,
and keep the Docker daemon unavailable to unrelated workloads. The pipeline
uses only official `node` images declared in `.ci/jenkins-compose.yml`.

## Pipeline design

After checkout, Jenkins prints only the commit SHA and branch. Each container
prints its Node and npm versions after installing the declared `npm@11.16.0`.
The quality matrix runs Node 20.19.0, 22, and 24 in parallel; every entry uses
the same lockfile installation and separately reports typechecking, build, and
each existing test suite. Node 24 also performs the blocking high/critical
dependency audit in parallel.

Each entry has a separate Compose volume. `COMPOSE_PROJECT_NAME` incorporates
the executor and build numbers, preventing concurrent Multibranch jobs sharing
the Docker host from sharing containers, networks, or workspaces. The pipeline
has a 30-minute global timeout, shorter GitHub-consumer and artifact timeouts,
stops obsolete same-branch builds, and removes Compose resources and the
workspace in `post { always }`.

The pipeline neither interpolates branch names into shell commands nor accepts
arbitrary Git references. The GitHub consumer job permits only the checked
40-character commit SHA or `refs/pull/<number>/head`, passes that value as an
environment variable, and invokes npm with argument arrays in Node.js. No
secrets, release credentials, or privileged publishing steps are present, so
untrusted pull requests cannot obtain them through this pipeline.

## Package and consumer gates

The quality jobs explicitly require `dist/index.mjs` and `dist/index.d.mts`
after the build. Existing package tests validate the complete npm dry-run
payload and public exports; existing consumer tests install the generated tarball
in a clean external project and verify both ESM runtime and NodeNext types.

Jenkins additionally runs `test:consumer:github`. For branch builds it installs
`github:Snyxex/PipeX#<checked-commit>`; for pull requests it installs
`github:Snyxex/PipeX#refs/pull/<number>/head`. This validates the actual GitHub
installation path, including the `prepare` build, against the code Jenkins is
validating rather than the default branch. It imports only the public `pipex`
entry point and checks `DataEngine`.

After the Node 24 quality gate succeeds, Jenkins creates one `npm pack` tarball
and archives that `.tgz` plus `dist/`, fingerprinted. It never archives
`node_modules`, temporary consumers, credentials, or caches. A later release
stage can consume the archived package only on an explicit `v*` tag, but no
release or npm publishing behavior is implemented now.

## GitHub Actions replacement matrix

| GitHub Actions step | Jenkins replacement |
| --- | --- |
| Checkout | `Checkout` stage with `checkout scm` |
| Node 20.19/22/24 matrix | Parallel quality stages backed by isolated Docker volumes |
| npm 11.16 installation | Every relevant container verifies npm 11.16.0 |
| `npm ci --ignore-scripts --no-audit --no-fund` | Every quality, audit, and GitHub-consumer container |
| Typecheck, build, tooling, unit, integration, security, package, consumer, performance | Explicit commands in every quality matrix entry |
| `npm audit --audit-level=high` | Blocking `Dependency audit` branch on Node 24 |
| GitHub Actions concurrency and timeouts | Declarative Jenkins options and stage timeouts |

The Jenkins pipeline adds an explicit Dist gate, artifact archive, and a remote
GitHub-install consumer smoke test. Once a green Jenkins Multibranch build has
been inspected, remove `.github/workflows/ci.yml` in a follow-up change and
update this document to mark Jenkins as the sole CI system.
