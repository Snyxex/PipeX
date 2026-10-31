# Security Policy

PipeX handles potentially sensitive application data and includes cryptographic, file-system, and streaming operations. Security reports are taken seriously.

## Supported versions

| Version | Security fixes |
| --- | --- |
| `main` | Active development and security fixes |
| Latest stable 1.0.x release | Best-effort fixes for verified vulnerabilities |
| Older releases | No guaranteed backports |

Use the latest maintained version. Supported Node.js major versions are 22, 24, and 26; the minimum declared runtime version is Node.js 22.

## Report a vulnerability privately

**Do not create a public issue, discussion, or pull request containing an undisclosed vulnerability, exploit, credential, or personal information.**

**Responsible-disclosure contact:** [GitHub private vulnerability report for PipeX](https://github.com/Snyxex/PipeX/security/advisories/new), when private reporting is enabled for the repository. This is the preferred secure submission channel. If that form is unavailable, open a public issue requesting a private reporting channel **without including technical vulnerability details**, and wait for a secure route before submitting the report.

A useful report includes the affected versions and environment, impact, concise reproduction steps or a proof of concept, and mitigations if known. Do not submit real user data, production secrets, or live credentials.

Maintainers will triage reports on a best-effort basis, coordinate remediation and disclosure with reporters, and publish a GitHub Security Advisory when appropriate. No guaranteed response or patch SLA is offered. Please allow time for a fix before public disclosure.

If you discover exposed credentials, treat them as compromised: revoke or rotate them at their provider immediately. Removing a file in a new commit does not remove it from Git history.

## Security boundaries

- `binary.pack()`, `binary.unpack()`, and the stream/file pack/unpack APIs are serialization, **not encryption**.
- Encrypted data should use authenticated encryption with properly generated, managed keys; never commit keys.
- Treat data and metadata received from another system as untrusted. Supply the expected result type from trusted application logic when undoing remotely sourced binary results.
- File operations require an application-controlled `allowedRoot`. Keep allowed roots writable only by trusted principals.
- Set appropriate size, concurrency, timeout, and framing limits; handle cancellation and stream backpressure.
- `dlq` / `setDlq()` are caller-owned failure sinks, not persistent replay or a queue.
- Consult [the encryption threat model and key-management guidance](docs/security.md), [enterprise security guidance](docs/enterprise.md), and [encryption migration guidance](docs/encryption-v4-migration.md).

## Supply-chain practices

Jenkins is the only project CI system; no GitHub Actions workflow is used. Pull requests with untrusted code must not receive credentials or privileged shared-host access. Release credentials must be isolated from ordinary CI builds.

The history review and its limitations are recorded in [docs/security-history-review.md](docs/security-history-review.md). A regex review does **not** certify the repository or its full Git object database as secret-free.
