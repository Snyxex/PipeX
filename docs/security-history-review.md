# Repository history security review

Reviewed: **2026-10-30**, prior to any repository history rewrite. Historical commit IDs are intentionally omitted from the public report.

## Scope and result

A targeted, read-only examination used GitHub's commit API to inspect the changed-line diffs in **115 commits reachable from `main` plus 6 additional unique commits from other branch tips** (the 100 most recent results plus 15 older results, and unique commits on the other six pre-existing branches). The current tracked-file inventory was also reviewed for sensitive-looking paths.

The checks looked for recognizable provider-token formats (including GitHub, npm, AWS, Google, OpenAI and GitLab), PEM private-key headers, database URLs containing inline passwords, obvious hard-coded credential assignments, and suspicious file names such as environment files, keys and certificates.

**No high-confidence matches were found by these patterns in the inspected diffs.** This is a limited negative finding, **not** proof that the entire repository or its history contains no secrets.

## Limitations

- GitHub commit diffs are not the same as scanning the raw bytes of every historical Git blob. Binary files, oversized or truncated patches, and data reachable only from other refs or unreachable objects may be missed.
- Format-based detection misses unknown token formats, obfuscated values, and secrets that resemble ordinary text. False positives and false negatives are possible.
- Git commit metadata can permanently expose contributor identities or email addresses even when project files contain no credentials.
- This review did not validate npm package ownership, GitHub secret-scanning configuration, or security settings that require administrator checks.
- No provider-side credential validity was tested; **never test a suspected credential by using it**.

## Required final local audit before publication

Run a dedicated history-aware secret scanner on a fresh full clone with complete history and all refs. For example, using a trusted `gitleaks` installation:

~~~sh
git clone --mirror https://github.com/Snyxex/PipeX.git PipeX-audit.git
gitleaks git --source PipeX-audit.git --redact --exit-code 1
~~~

Check the installed scanner version and command-line syntax first. Review findings privately and avoid copying suspected secrets into CI logs or public PRs. Verify that GitHub secret scanning, push protection and private vulnerability reporting are enabled when available.

If a real secret is discovered, revoke/rotate it with the provider immediately, assess exposure and affected services, then coordinate history remediation using an offline full clone and GitHub Support. A normal deletion commit is insufficient to remove exposed historical content.
