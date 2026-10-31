# PipeX runnable examples

These seven standalone scripts use the **built package** and the current public API. Run from the repository root after installing dependencies and building:

```sh
npm ci
npm run build
node examples/01-gzip-file.mjs
node examples/02-aes-256-gcm.mjs
node examples/03-sha256-stream.mjs
node examples/04-compress-encrypt-hash.mjs
node examples/05-custom-transform.mjs
node examples/06-worker-pipeline.mjs
node examples/07-errors-abort.mjs
```

Or verify them all with `npm run test:examples`. Scripts log only a success message; failed assertions exit nonzero.

| Script | Demonstrates |
| --- | --- |
| `01-gzip-file.mjs` | Atomic file compression and decompression with temporary files |
| `02-aes-256-gcm.mjs` | AEAD encryption, authentication and 32-byte key handling |
| `03-sha256-stream.mjs` | Stream-based keyed SHA-256 HMAC with fragmentation |
| `04-compress-encrypt-hash.mjs` | Ordered compression, encryption and HMAC |
| `05-custom-transform.mjs` | Custom reversible `ProcessorPlugin` implementation |
| `06-worker-pipeline.mjs` | Piscina worker pool and caller-owned `worker-transform.mjs` |
| `07-errors-abort.mjs` | Typed failures and pre-aborted `AbortSignal` |

## Key handling

AES uses a fresh cryptographically random 32-byte key for every run unless `PIPEX_KEY_HEX` is explicitly supplied. To use an environment-provided key, set **64 hexadecimal characters** via your secret manager. The scripts do not print or store keys. The example clears its local AES key buffer after use. Real systems must persist or manage encryption keys securely through KMS to decrypt data later; process environment variables can be exposed by privileged local processes.

The stream hashing example demonstrates **HMAC-SHA-256**, not an unkeyed SHA-256 digest. It generates a fresh secret in memory; a production verifier needs securely shared key material.

## Notes

The file example cleans up a temporary directory even when a test fails. These examples target Node.js 22+ and do not require Docker. The worker example creates a real worker thread and closes the worker pool on completion. Do not copy secrets into logs or repositories. `examples/` is development-only and is not part of the published npm tarball.
