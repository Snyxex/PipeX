---
name: api-reference-navigation
description: Locate and verify the exact PipeX public API, signatures, capabilities, and implementation before generating integration code.
---
# PipeX API reference navigation

Use this skill whenever an AI agent needs to answer how PipeX works or write PipeX code.

## Source map
| Question | Authoritative location |
| --- | --- |
| Public exports and built-in registrations | `src/index.ts` |
| Engine construction, limits, events, configuration | `src/core/dataEngine.ts` |
| Types, contexts, KMS contracts and results | `src/core/types.ts` |
| Binary serialization, transformations and undo | `src/core/controllers/BinaryController.ts` |
| File processing and atomic outputs | `src/core/controllers/FileController.ts`, `src/core/secureFiles.ts` |
| Stream transforms and object framing | `src/core/controllers/StreamController.ts` |
| Plugin base class and concrete options | `src/core/plugin.ts`, `src/plugin/` |
| Runtime package entrypoints | `package.json`, `dist/` after build |
| Security and operational contracts | `docs/enterprise.md`, `test/security/` |
| Supported examples and behavior | `README.md`, `test/` |

## Verified API patterns in this repository
- `new DataEngine(limits?)`; `engine.use(plugin)`; `await DataEngine.fromConfig(config)`.
- `engine.binary.pack(data)` and `unpack(buffer)` are synchronous serialization only.
- `await engine.binary.run(input, options?)` transforms; `undo(result, { expectedType })` restores.
- `engine.file.process(input, output, allowedRoot?, options?)` and `reverse(...)` use protected file sessions.
- `engine.stream.pipe(readable, writable, reverse, options?)` transforms streams.
- `DataEngine.registerPlugin(name, Class)` registers config-driven plugins.
- `engine.pluginCapabilities` and `engine.pipeline` expose immutable views.

## Method
1. Check the checked-out commit and installed version; do not assume `main` matches the consumer.
2. Read `src/index.ts` and the controller method signature before providing a code sample.
3. Confirm required options, synchronous versus asynchronous behavior, errors and limits.
4. Prefer exported symbols over internal imports.
5. Validate a runnable example with the actual installed package and TypeScript when possible.
6. If source and documentation disagree, report the discrepancy rather than guessing.
