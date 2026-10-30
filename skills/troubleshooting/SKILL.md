---
name: troubleshooting
description: Debug PipeX integration, installation, CI and runtime failures.
---
# troubleshooting

Use this skill when the task matches the description.

## Instructions
Collect exact version, Node/npm versions, operating system, operation, redacted error and reproduction. Check package exports, npm install scripts, native Koffi bindings for file operations, configured plugin capabilities, limits and AbortSignal. For Jenkins, distinguish checkout/JVM failures from actual tests and inspect exact commit. Prefer minimal reproducible cases and avoid speculative fixes. Never request secrets.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
