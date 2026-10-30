---
name: testing-examples
description: Write executable examples and regression tests for PipeX.
---
# testing examples

Use this skill when the task matches the description.

## Instructions
Start with README quick start, src/index.ts, current tests and package.json scripts. Prefer self-contained ESM/TypeScript examples using public exports, temp directories and finally cleanup. Cover success, reverse roundtrip, invalid input, abort, stream backpressure, file path boundaries and package consumer imports. Use npm run quality:ci; do not claim success unless run. Avoid real secrets or network dependencies in examples.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
