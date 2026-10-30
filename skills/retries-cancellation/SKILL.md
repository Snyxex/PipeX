---
name: retries-cancellation
description: Handle retries, deadlines and aborts correctly.
---
# retries cancellation

Use this skill when the task matches the description.

## Instructions
Use OperationOptions { signal, timeoutMs } and inspect src/core/operations.ts and controller signatures. Plugin RetryOptions supports attempts, backoff ('exponential'|'fixed'), delayMs. Engine limits cap attempts and delay. Avoid retrying non-idempotent external side effects without an explicit policy. Cancellation may leave non-cooperative work in progress and capacity reserved until settled; do not promise immediate teardown. Test timeouts, abort, and cleanup.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
