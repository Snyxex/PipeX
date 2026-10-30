---
name: security-review
description: Threat-model PipeX usage and prevent unsafe integrations.
---
# security review

Use this skill when the task matches the description.

## Instructions
Review docs/enterprise.md, docs/encryption-v4-migration.md and security tests. Treat paths, payloads, metadata, schemas and plugin options as untrusted unless verified. Set limits and deadlines, use trusted expectedType, authenticate encrypted frames before release, restrict file roots, avoid secret logging and untrusted plugin execution. Do not claim the engine itself supplies authentication, a sandbox or persistence.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
