---
name: file-processing
description: Process files securely using PipeX file controller.
---
# file processing

Use this skill when the task matches the description.

## Instructions
Use engine.file.process(inputPath, outputPath, allowedRoot, { timeoutMs }) and file.reverse for inverse transformation. Parent directories must exist. allowedRoot defaults to current working directory; prefer explicit exclusive-control roots. PipeX rejects traversal, symlink escapes, special files and same/hard-linked input-output. Native bindings use Koffi; test actual target OS and atomic replacement failure cases. Never bypass file controller path validation.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
