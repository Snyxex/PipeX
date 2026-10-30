---
name: kms-providers
description: Integrate KMS providers and encryption envelopes.
---
# kms providers

Use this skill when the task matches the description.

## Instructions
Inspect src/plugin/kms_encryption.ts, src/core/kmsCapabilities.ts, KmsProvider and KmsRequestOptions in src/core/types.ts. Provider may implement encrypt, decrypt, generateDataKey and declare capabilities. Pass and honor AbortSignal; explicit false disables operations even if stubs exist. Enforce key-id and encrypted-key limits. Keep plaintext data keys ephemeral, do not log them. Test provider unavailable, authentication failure, cancellation and capability mismatch.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
