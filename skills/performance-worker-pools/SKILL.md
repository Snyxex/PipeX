---
name: performance-worker-pools
description: Use bounded concurrency, worker pools and benchmarks.
---
# performance worker pools

Use this skill when the task matches the description.

## Instructions
Inspect src/plugin/worker.ts, WorkerPoolOptions and docs/enterprise.md#local-worker-pools. The worker-pool executes caller-owned worker module exports with bounded threads, queue admission, task deadlines and shutdown. EngineLimits includes maxConcurrentOperations, maxInputBytes, maxOutputBytes and frame bounds. Do not equate worker pools with durable job queues. Run npm run test:performance and manual npm run benchmark:large only with adequate resources; benchmark is not a correctness proof.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
