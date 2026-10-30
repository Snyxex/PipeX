---
name: configuration
description: Build config-driven pipelines with registered plugins.
---
# configuration

Use this skill when the task matches the description.

## Instructions
Use await DataEngine.fromConfig({ limits, logger, auditLogger, plugins:[{name:'compression',options:{type:'brotli',level:5}}] }). Built-in names: compression, encryption, hashing, benchmark, worker-pool, validation, kms-encryption. Register custom classes via DataEngine.registerPlugin(name, Class) before fromConfig. Options with Zod schemas, keys or KMS provider instances must be supplied programmatically. engine.pipeline and engine.plugins are immutable snapshots; do not mutate during active operations.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
