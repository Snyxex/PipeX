---
name: compression
description: Configure compression and decompression safely.
---
# compression

Use this skill when the task matches the description.

## Instructions
Use CompressionPlugin from 'pipex'; README demonstrates new CompressionPlugin({ type: 'gzip', level: 6 }) and type 'brotli'. Inspect src/plugin/compression.ts for accepted options, supported codecs, limits, and reverse behavior. Apply compression before authenticated encryption when appropriate. Do not assert universal size savings or use decompression on untrusted inputs without output limits. Test roundtrip and expansion boundaries.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
