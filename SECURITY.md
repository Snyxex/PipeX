# Security Policy

PipeX handles potentially sensitive binary data, streams and cryptographic operations. Please report vulnerabilities privately, not through public issues or pull requests.

## Private vulnerability reporting

**Preferred channel:** [Submit a private GitHub Security Advisory report](https://github.com/Snyxex/PipeX/security/advisories/new).

This page is the intended confidential reporting route **when GitHub private vulnerability reporting is enabled**. If the form is not available, use an existing private contact channel with a repository maintainer (for example, a private contact option shown on the maintainer's GitHub profile). If no such option exists, open a public issue **only to request a private channel**; never put exploit details, proof of concept, credentials or sensitive data in that request. The maintainer must enable GitHub private vulnerability reporting for the advisory submission flow to work.

A useful confidential report includes impacted versions, runtime/environment, impact, minimal reproducible steps using synthetic data, expected versus actual results and any mitigation. Do not include live credentials or third-party private information.

Maintainers will assess reports on a best-effort basis, coordinate a fix and disclosure with the reporter and issue a GitHub Security Advisory when appropriate. No guaranteed SLA or bounty is offered. Please allow coordination before publication.

## Supported releases

| Release | Security maintenance |
| --- | --- |
| `main` | Active development and security patches |
| Latest stable `1.0.x` | Best-effort updates for confirmed issues |
| Older versions | No guaranteed backports |

Node.js 22, 24 and 26 are the project's CI targets; Node.js 22 is the minimum package runtime.

## Security practices

- Treat all remote input and metadata as untrusted. Serialization and encryption are different operations.
- Use authenticated encryption, securely generated keys and trusted key management; do not store secrets in source code or example fixtures.
- Set limits for input/output, frames, concurrency and timeouts; preserve backpressure and cancellation.
- Restrict file operations to an application-controlled `allowedRoot`; handle symbolic links and filesystem races carefully.
- Jenkins is the only CI system. Do not expose privileged CI agents or npm publishing credentials to untrusted PR code.
- If a secret is exposed, **revoke or rotate it immediately**. Deleting a file or adding an ignore rule does not remove the secret from prior commits.
- See [security guidance](docs/security.md), [enterprise guidance](docs/enterprise.md) and [history-review limitations](docs/security-history-review.md). A keyword or regex scan does not prove the complete Git object history is secret-free.
