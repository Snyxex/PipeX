---
name: error-handling
description: Diagnose PipeX errors without hiding security failures.
---
# error handling

Use this skill when the task matches the description.

## Instructions
Inspect exported errors in src/index.ts and src/core/errors.ts, including OperationAbortedError, OperationTimeoutError, UnsupportedReverseError, UnsupportedStreamingError, KmsProviderError and worker pool errors. Preserve error causes and request IDs; distinguish validation failures from corrupt ciphertext and infrastructure failures. Do not retry authentication failures blindly. Test representative negative paths.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
