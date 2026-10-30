---
name: binary-transformations
description: Choose binary.run/undo versus MessagePack pack/unpack.
---
# binary transformations

Use this skill when the task matches the description.

## Instructions
Use engine.binary.run(input) for configured plugin transformations and engine.binary.undo(result, { expectedType: 'object' }) for transported or reconstructed results. Set expectedType from trusted application configuration, never untrusted metadata. binary.pack/unpack perform serialization only: no compression, hashing, or encryption. Inspect BinaryController and EngineResult before coding. Test roundtrip, corrupt payload, limits, and wrong type.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
