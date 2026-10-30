---
name: observability
description: Integrate logs, traces, audit records and events.
---
# observability

Use this skill when the task matches the description.

## Instructions
Use engine.setLogger(logger), setTracer(tracer), setAuditLogger(auditLogger); inspect Logger, Tracer, Span and AuditRecord types. Events include start, plugin:after, progress, error, end and manifest; observe request IDs. Observer callback failures are isolated. Audit record pluginChain is empty for pack/unpack serialization operations. Avoid recording plaintext, keys, tokens or sensitive chunks. Validate instrumentation with tests.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
