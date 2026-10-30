---
name: pipex-core
description: Use PipeX as a TypeScript/JavaScript data transformation engine; inspect its public API before coding.
---
# PipeX core usage

Use this skill when integrating PipeX into a Node.js application, designing transformation pipelines, or reviewing PipeX API usage.

## Workflow
1. Read the project's installed PipeX version and `README.md`, `src/index.ts`, and `src/core/dataEngine.ts` (or published declarations).
2. Check the actual exported API and plugin registration before proposing code. Do not invent method names.
3. Respect `engines.node >=20.19.0` for the current repository version; validate dependency engine requirements separately.
4. Use `DataEngine` and exported plugin classes only according to their current signatures.
5. Prefer minimal runnable ESM examples and include error handling where appropriate.
6. Verify with `npm run typecheck`, `npm run build`, and relevant tests.

## Constraints
- PipeX is a data engine, not a scheduler, queue manager, or persistent message broker.
- Caller-provided Writable streams remain caller-owned. Do not claim PipeX stores or replays DLQ items.
- Do not promise delivery guarantees, job scheduling, or retry persistence without inspecting code.
- Do not assume GitHub installation and npm registry publication are equivalent.

## Source of truth
`README.md`, `src/index.ts`, `src/core/types.ts`, `src/core/dataEngine.ts`, and tests in the checked-out commit.
