# Detailed Jenkins results in GitHub

PipeX uses Jenkins as its only CI system. This branch adds JUnit XML reporting to the existing Node.js 22/24/26 quality stages. The Node.js test runner emits its regular console output plus a JUnit file per test suite when `PIPEX_JUNIT_DIR` is defined. Jenkins publishes the results in each stage's `post { always { junit ... } }` block, even when that stage fails.

## Jenkins administrator prerequisites

1. Install or verify **JUnit**, **Checks API**, and **GitHub Checks** Jenkins plugins, with compatible versions. Restart Jenkins if requested.
2. Configure GitHub Checks publishing using a GitHub App connection with the **Checks: Read and write** permission and repository access, and verify Jenkins resolves the correct GitHub SCM source. A personal access token used for legacy commit statuses is not automatically equivalent to a GitHub App Checks integration.
3. Ensure no GitHub Actions workflow is introduced. Keep fork PR builds off the privileged shared agent.
4. Run a test branch PR and inspect GitHub's **Checks** tab. Confirm individual test names and the Node.js stage status appear; plugin naming and annotations depend on installed versions.

The XML error bodies and the test failure messages are replaced by generic text before publishing, because a failed assertion may embed sensitive payloads. GitHub shows the failing test name, suite, count and Node version; **full diagnostic differences and stack traces remain in the Jenkins build log**. This is a deliberate privacy limit, not an assertion that every failure reason is shown on GitHub. Errors before test execution (checkout, merge conflict, TypeScript or build) still use the existing commit status and Jenkins console output.

## Testing

```sh
npm ci --ignore-scripts
npm run build
PIPEX_JUNIT_DIR="$PWD/.artifacts/junit/local" npm run test:unit
```

The `.artifacts/` directory is ignored by Git. Jenkins deletes it during workspace cleanup. No raw environment variable values or private logs are transmitted as check annotations by this change.
