---
name: migration-compatibility
description: Migrate PipeX versions and encrypted formats safely.
---
# migration compatibility

Use this skill when the task matches the description.

## Instructions
Read package.json, docs/encryption-v4-migration.md, README and changelog if present. Check actual exports and behavior for installed version, Node >=22 declaration, and ESM requirements. For binary.undo reconstructed data, use trusted expectedType. Encryption v4 writer produces versioned PXAE; plan and test legacy-reader disablement. Preserve dlq/setDlq compatibility. Do not claim backward compatibility without fixtures and tests.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
