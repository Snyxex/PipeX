---
name: validation-schemas
description: Use Zod validation and schema registries.
---
# validation schemas

Use this skill when the task matches the description.

## Instructions
Inspect src/core/validation.ts and src/core/dataEngine.ts. engine.setSchema(zodSchema) validates through safeParse; engine.setSchemaRegistry({getSchema}) and await engine.loadSchema(subject, version) load dynamic schemas. fromConfig accepts schema and schemaRegistry as runtime objects; not JSON serializable. Check validation timing for each controller. Test malformed input, unknown schema and version drift.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
