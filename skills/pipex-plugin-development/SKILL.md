---
name: pipex-plugin-development
description: Implement or review PipeX plugins using the existing plugin contracts, capabilities, and tests.
---
# PipeX plugin development

Use when creating, extending, or debugging a PipeX plugin.

## Workflow
1. Inspect `src/core/plugin.ts`, `src/core/types.ts`, `src/core/dataEngine.ts`, and representative plugins in `src/plugin/`.
2. Identify required plugin lifecycle methods, types, operation names, capability metadata, and error behavior from code.
3. Preserve compatibility with existing `DataEngine.registerPlugin` registration and configuration paths.
4. Implement typed behavior, input validation, failure propagation, and cleanup for allocated resources.
5. Add tests for success, invalid input, concurrency where relevant, and failure/abort handling.
6. Run typecheck, build, unit and integration tests before claiming completion.

## Guardrails
- Do not add hidden persistence or internal replay queues.
- Preserve existing `dlq` / `setDlq()` public semantics unless explicitly instructed otherwise.
- Keep plugin operations and capability declarations consistent.
- Never assume a plugin is registered automatically without checking `src/index.ts`.
