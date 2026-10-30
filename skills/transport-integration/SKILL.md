---
name: transport-integration
description: Integrate PipeX into HTTP, RPC, CLI and SDK transports.
---
# transport integration

Use this skill when the task matches the description.

## Instructions
PipeX transforms data; it does not provide a network protocol, authentication, HTTP server, RPC transport or durable delivery. Choose binary.run/undo for in-memory payload transformations; pack/unpack only serialize. Transport must define framing, metadata trust boundaries, max payload sizes, backpressure, authentication and retry policy. Use trusted expectedType on binary.undo for received results. Test interoperability and malformed remote input.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
