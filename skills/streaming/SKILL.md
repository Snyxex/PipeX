---
name: streaming
description: Implement Node.js streaming with backpressure and safe cancellation.
---
# streaming

Use this skill when the task matches the description.

## Instructions
Use engine.stream.pipe(readable, writable, false, { signal, timeoutMs }) for forward transformation; inspect StreamController for reverse semantics. stream.pack/unpack serialize object frames only. Caller owns the Writable and lifecycle; do not claim automatic storage/replay. For custom plugins, chunk fallback requires chunk-independent behavior; whole-message algorithms need a native framed stream. Test backpressure, truncation, abort, and errors.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
