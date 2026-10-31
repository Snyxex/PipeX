# Encryption security and threat model

This document covers the cryptographic boundary of `@snyxex/pipex`. It is not an independent security audit or a certification.

## Supported algorithms and formats

| Component | Algorithm | Authentication |
| --- | --- | --- |
| `EncryptionPlugin` | AES-256-GCM | 16-byte AEAD tag for each framed record and an authenticated final frame |
| `EncryptionPlugin` | ChaCha20-Poly1305 | 16-byte AEAD tag for each framed record and an authenticated final frame |
| `KmsEncryptionPlugin` | AES-256-GCM envelope encryption | 16-byte AEAD tag, using the KMS provider's generated data key |
| `HashingPlugin` | HMAC-SHA-256 and HMAC-SHA-512 | Keyed integrity, **not confidentiality** |

All cryptographic operations use Node.js `node:crypto`. PipeX does not implement its own cipher primitives.

## Keys, salts, nonces and tags

`EncryptionPlugin` requires a caller-supplied **32-byte Buffer key**. There is no fallback key or embedded secret. Keep keys in a secret manager; use distinct keys by environment and encryption domain. Do not log, commit, or derive production keys from hard-coded strings. The library does not store or rotate your keys.

The current PXAE framed writer generates a 16-byte random salt with Node.js `randomBytes()`, derives a fresh per-message encryption key with HKDF-SHA-256, and constructs a 12-byte nonce from the unique frame sequence within that message. The salt/header and frame metadata are authenticated as associated data (AAD). Frame tags are 16 bytes; `decipher.final()` must succeed before the frame plaintext is released. The authenticated final frame detects truncation; reordered, duplicated and malformed frame sequences are rejected. Never assume complete-message success until the stream finishes without error.

The legacy unversioned v3 reader is **disabled by default in this hardening branch**. Set `allowLegacyDecrypt: true` only for a controlled migration, then disable it again. Legacy decryption may buffer an entire input up to configured byte limits. The writer always produces the modern framed format.

The KMS plugin obtains a plaintext/wrapped data key from the caller's KMS provider, generates a fresh 12-byte random IV via `randomBytes()`, and attempts to zero plaintext data-key buffers after use. KMS provider security, IAM policy, key rotation, and availability are the application operator's responsibility.

## Failure behavior

- Invalid/missing keys throw `InvalidKeyError`.
- AEAD tag verification failures throw `AuthenticationError`; no decrypted plaintext is returned for the failing frame.
- Unsupported algorithms and invalid encryption settings throw `EncryptionError`.
- Malformed/truncated headers or frames, limit violations, and cancelled operations reject. Not every parse error is an `AuthenticationError`; validate by error classification rather than exposing internal distinctions to untrusted clients.
- Errors should not include secret key material or ciphertext. Avoid logging raw exceptions from external KMS clients or private payloads.

## Threat model

The protected assets are the confidentiality and integrity of transformed data and application-held encryption keys. The attacker may control or tamper with stored ciphertext, frames, network transport, or metadata; they are **not** assumed to know the 32-byte key or to execute arbitrary code inside the application process.

Within that model, AEAD authenticates encrypted frames and finalization. It does **not** prevent replay of an entire previously valid encrypted message, protect a compromised host or key, authenticate the business identity of a sender, provide authorization, or guarantee tenant isolation. The application must implement replay controls, identity checks, secure endpoints, and protected key storage.

## Known limitations

- Streaming output can expose earlier **individually authenticated frames** before a later frame or the final marker fails. Stage sensitive outputs until the full stream completes if atomicity is required.
- The binary API is in-memory. Streaming reduces buffer pressure, but maximum frame sizes and legacy payload paths still determine memory needs.
- A legacy migration option intentionally accepts an older wire format and should remain disabled by default.
- `KmsEncryptionPlugin` supports binary operations only; its provider is supplied by the application.
- `HashingPlugin` provides keyed HMAC verification, not encryption or password hashing.
- Secrets passed as `Buffer` remain subject to Node.js/V8 memory management; wiping some temporary buffers does not guarantee erasure of every memory copy.
- Nonce uniqueness depends on never reusing the same per-message derived key/nonce sequence; use independent random salts and well-managed master keys. Rotate keys and monitor message volumes according to your environment's cryptographic policy.

## Reporting

Follow the private disclosure instructions in [../SECURITY.md](../SECURITY.md). Never include production keys, customer data, or exploitable details in a public issue.
