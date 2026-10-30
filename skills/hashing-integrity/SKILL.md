---
name: hashing-integrity
description: Use PipeX hashing and HMAC with correct integrity semantics.
---
# hashing integrity

Use this skill when the task matches the description.

## Instructions
Inspect src/plugin/hashing.ts and HashingOptions before selecting algorithm/secret. README shows config { name:'hashing', options:{ algorithm:'sha256', secret:process.env.PIPEX_HMAC_SECRET } }. HMAC streaming verifies at EOF and withholds the bounded complete message; do not present hashing alone as confidentiality or encryption. Never log secrets; verify mismatch and truncation behavior in tests.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
