---
name: failure-sinks
description: Use caller-provided failure sinks without assuming a message queue.
---
# failure sinks

Use this skill when the task matches the description.

## Instructions
fromConfig accepts dlq: Writable and engine.setDlq() retains the legacy name. This is a caller-owned failure sink, not durable storage, a scheduler, replay, or queue semantics. Inspect docs/enterprise.md#retries-and-caller-provided-failure-sink and current source. Consider confidentiality of failed chunks and the Writable's backpressure and lifecycle. Document persistence/replay as application responsibilities.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
