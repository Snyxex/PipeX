# PipeX

PipeX composes compression, authenticated encryption, and HMAC integrity checks into reversible data-processing pipelines for Node.js buffers, files, and streams.

[![npm version](https://img.shields.io/npm/v/@snyxex/pipex)](https://www.npmjs.com/package/@snyxex/pipex)
[![license](https://img.shields.io/github/license/Snyxex/PipeX)](https://github.com/Snyxex/PipeX/blob/main/LICENSE)
[![CI](https://img.shields.io/badge/CI-Jenkins-informational)](https://github.com/Snyxex/PipeX/commits/main/)
[![TypeScript](https://img.shields.io/badge/TypeScript-types-included-blue)](https://github.com/Snyxex/PipeX/blob/main/package.json)
[![npm package size](https://img.shields.io/npm/unpacked-size/@snyxex/pipex)](https://www.npmjs.com/package/@snyxex/pipex)

## Installation

```sh
npm install @snyxex/pipex
```

Requires **Node.js 22 or newer** and ESM. PipeX uses Node.js streams, cryptography, and filesystem facilities; it does not provide a browser build. Jenkins tests Node.js 22, 24, and 26.

## Quick Start

This in-memory example requires no native filesystem bindings.

```ts
import { DataEngine, CompressionPlugin } from '@snyxex/pipex';

const engine = new DataEngine().use(
  new CompressionPlugin({ type: 'gzip', level: 6 }),
);

const encoded = await engine.binary.run({ id: 42, status: 'ready' });
const original = await engine.binary.undo<{ id: number; status: string }>(encoded);

console.log(original); // { id: 42, status: 'ready' }
```

## Core Concepts

- **DataEngine:** Owns the configured plugin chain, resource limits, operation lifecycle, and binary/file/stream controllers.
- **Controllers:** `engine.binary` processes in-memory values, `engine.file` works with paths under an allowed root, and `engine.stream` connects Node.js streams.
- **Plugin:** Implements `process(Buffer, context)` and optionally `reverse` or `createStream`.
- **Transformation:** Plugins run in registration order. Reverse transformations execute reversible plugins in the opposite order.
- **Capabilities:** Query whether a plugin supports processing, reversal, or native/fallback streaming.
- **Execution context:** Request-scoped metadata, cancellation signal, limits, and optional logging/tracing.
- **Source and destination:** The input and output objects passed to the relevant controller; they are concepts, not exported PipeX classes.

`pack()` and `unpack()` are **serialization-only** operations; they do not apply the transformation pipeline.

## Transformation Examples

### Compression

```ts
import { DataEngine, CompressionPlugin } from '@snyxex/pipex';

const engine = new DataEngine().use(new CompressionPlugin({ type: 'brotli', level: 5 }));
const result = await engine.binary.run('Repeated application data');
console.log(await engine.binary.undo<string>(result));
```

Compression types: `gzip`, `brotli`, and `none`.

### Encryption

```ts
import { randomBytes } from 'node:crypto';
import { DataEngine, EncryptionPlugin } from '@snyxex/pipex';

// Demonstration only: retain this key securely to decrypt persisted data.
const key = randomBytes(32);
const engine = new DataEngine().use(new EncryptionPlugin({
  algorithm: 'aes-256-gcm',
  key,
  allowLegacyDecrypt: false,
}));

const encrypted = await engine.binary.run('confidential');
const plaintext = await engine.binary.undo<string>(encrypted);
console.log(plaintext);
```

Alternative algorithm: `chacha20-poly1305`. Both require a 32-byte key.

### Hashing / HMAC integrity

```ts
import { DataEngine, HashingPlugin } from '@snyxex/pipex';

const engine = new DataEngine().use(new HashingPlugin({
  algorithm: 'sha256',
  secret: process.env.PIPEX_HMAC_SECRET ?? (() => { throw new Error('Missing HMAC key'); })(),
}));

const signed = await engine.binary.run('message');
const verified = await engine.binary.undo<string>(signed);
console.log(verified);
```

`HashingPlugin` **appends a keyed HMAC** and verifies it during reversal. It is not a standalone, one-way digest API. The secret must contain at least 16 characters; use a high-entropy secret in production.

### Combined reversible pipeline

```ts
import { randomBytes } from 'node:crypto';
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from '@snyxex/pipex';

const encryptionKey = randomBytes(32);
const hmacSecret = randomBytes(32).toString('hex');
const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: encryptionKey }))
  .use(new HashingPlugin({ algorithm: 'sha512', secret: hmacSecret }));

const result = await engine.binary.run({ event: 'example' });
const restored = await engine.binary.undo<{ event: string }>(result);
console.log(restored);
```

Keep keys outside code and configuration repositories. The HMAC in this example is an optional additional integrity layer; authenticated encryption already authenticates encrypted data.

## Data Interfaces

| Controller | Use | Runtime considerations |
| --- | --- | --- |
| `engine.binary` | Values and buffers held in memory | Does not load native file bindings |
| `engine.file` | Files on disk | Uses Koffi-based native filesystem operations |
| `engine.stream` | Large streams, pipes, sockets | Uses Node.js backpressure and supports `AbortSignal` |

### Binary

```ts
const encoded = await engine.binary.run({ ok: true });
const decoded = await engine.binary.undo(encoded);
const serialized = engine.binary.pack({ ok: true });
const parsed = engine.binary.unpack<{ ok: boolean }>(serialized);
```

For data reconstructed after transport or storage, supply a trusted `expectedType` to `undo`; never trust unverified type metadata.

### Files

```ts
await engine.file.process('./data/source.bin', './data/source.px', './data');
await engine.file.reverse('./data/source.px', './data/restored.bin', './data');
```

Output is staged and atomically replaced. Paths are restricted to `allowedRoot`; create the parent directories first.

### Streams

```ts
import { createReadStream, createWriteStream } from 'node:fs';

const controller = new AbortController();
await engine.stream.pipe(
  createReadStream('./source.bin'),
  createWriteStream('./output.px'),
  false,
  { signal: controller.signal, timeoutMs: 30_000 },
);
```

The `reverse` argument is `true` when decoding. Serialization-only stream adapters are `engine.stream.pack()` and `engine.stream.unpack()`.

## Plugins

### Built-in plugins

| Plugin | Purpose | Notes |
| --- | --- | --- |
| `CompressionPlugin` | Gzip/Brotli transformations | Reversible; native streaming |
| `EncryptionPlugin` | AES-256-GCM / ChaCha20-Poly1305 | Reversible authenticated frames |
| `HashingPlugin` | HMAC-SHA-256 / HMAC-SHA-512 | Appends and verifies a keyed digest |
| `BenchmarkPlugin` | Processing metrics | Observes transformation timings |
| `ValidationPlugin` | Application schema validation | Integrates Zod |
| `WorkerPoolPlugin` | Caller-supplied worker module transforms | Opt-in local Piscina pool |
| `KmsEncryptionPlugin` | Envelope encryption using caller-supplied KMS | Binary-only; needs KMS provider |

The `Plugins` object exposes these constructors under their shortened names, e.g. `Plugins.Compression`.

### Plugin lifecycle

Register with `engine.use(plugin)` in the intended order, or use `DataEngine.fromConfig()` with registered plugin names. Third-party plugins may implement `ProcessorPlugin` or extend `BasePlugin`. Registration validates capability declarations; pipeline configuration cannot change during an active operation. Reverse operations reject pipelines containing non-reversible plugins rather than silently skipping a step.

Read [the full API reference](docs/api.md) for the plugin contract, constructor options, and error types.

## Streaming & Backpressure

`stream.pipe(source, destination, reverse?, options?)` connects a source to the configured transform chain and destination, awaiting completion. Node.js backpressure propagates across native stream plugins. `stream.into(destination)` and `stream.reverseInto(destination)` expose writable adapters for use with Node.js pipelines.

Plugins lacking `createStream()` use a per-chunk fallback **only when chunk independence is valid**. Such a fallback is not suitable for algorithms requiring whole-message authentication or global framing.

Authenticated encryption emits bounded frames, each verified before its plaintext is released. Previously authenticated frames can already have been consumed if a later frame or final marker fails: **treat successful stream completion as the transaction commit point**. HMAC verification, unlike per-frame AEAD, withholds complete bounded plaintext until its final digest verifies.

Cancellation uses `AbortSignal`; operation limits and deadlines apply to stream processing.

## API Reference

See **[docs/api.md](docs/api.md)** for public entry points, signatures, options, return values, error classes, and serialization semantics.

Primary operations:

```ts
new DataEngine(limits?)
DataEngine.fromConfig(config)
engine.use(plugin)
engine.binary.run(input, options?)
engine.binary.undo(result, options?)
engine.binary.pack(data)
engine.binary.unpack(buffer)
engine.file.process(inputPath, outputPath, allowedRoot?, options?)
engine.file.reverse(inputPath, outputPath, allowedRoot?, options?)
engine.stream.pipe(source, destination, reverse?, options?)
```

## Security

**Hashing is not encryption.** HMAC detects unauthorized modification when its key remains secret; it does not conceal contents. Authenticated encryption provides confidentiality and integrity. Complete-message integrity for framed encrypted streams is confirmed only after the final authenticated frame and successful completion.

- **Encryption:** AES-256-GCM and ChaCha20-Poly1305 with 32-byte keys; authenticated framing uses the `PXAE` v4 format.
- **Authentication tags:** A frame is not emitted as plaintext until its AEAD tag verifies. Sequence numbers and a final authenticated frame detect reordering, duplication, and truncation.
- **Key handling:** Supply keys through a secret manager or application-managed KMS. PipeX is not a key vault. Do not reuse a randomly generated per-process key for data requiring later decryption.
- **HMAC:** SHA-256 or SHA-512 with a caller-owned secret. A mismatched or truncated digest rejects reversal.
- **Limits:** Input, output, frame, concurrency, and timeout limits protect the host; configure them for the deployment.
- **KMS:** External providers are supplied by the application; the KMS plugin is binary-only and requires a working `generateDataKey` capability.

**Compatibility:** Version 4 encryption writes framed `PXAE` only. Reading legacy unversioned v3 encrypted data is a temporary migration option (`allowLegacyDecrypt`, default `true`); disable it after migration. Format compatibility is not a promise that all future versions or arbitrary plugin combinations can read every older payload. Keep original plugin configuration and secrets where reversibility is required.

See [Encryption migration](docs/encryption-v4-migration.md) and [Production security](docs/enterprise.md).

## Error Handling

Operations reject on invalid configuration, unsupported reverse/stream operations, resource-limit violations, authentication failures, aborted operations, timeouts, and underlying stream/filesystem errors. Typed errors include `PipeXError`, `UnsupportedReverseError`, `UnsupportedStreamingError`, `OperationAbortedError`, `OperationTimeoutError`, and worker/KMS errors. Check `error.code` on `PipeXError` when branching on supported classifications; other errors may be ordinary `Error` instances.

```ts
import { OperationTimeoutError } from '@snyxex/pipex';

try {
  await engine.binary.run('data', { timeoutMs: 1000 });
} catch (error) {
  if (error instanceof OperationTimeoutError) {
    console.error('Transformation timed out');
  } else {
    throw error;
  }
}
```

## Optional Features

- **Worker Threads:** `WorkerPoolPlugin` is opt-in at runtime, but `piscina` is presently installed as a regular dependency. Workers execute caller-provided module exports, not a built-in job scheduler.
- **Native file operations:** `engine.file` uses `koffi`, currently a regular dependency. Binary and stream controllers do not load these native bindings. File operations fail if required native bindings are unavailable; there is no path-only fallback.
- **KMS:** `KmsEncryptionPlugin` requires a provider implementation supplied by your application.
- **Validation and observability:** Zod validation, logging, tracing, audit logging, and caller-owned failure sinks are integrated only when configured.

## Performance & Resource Limits

Streaming reduces whole-payload buffering, but some operations (including HMAC verification and binary processing) necessarily retain bounded data in memory. The engine enforces finite defaults for input/output bytes, frames, concurrent operations, retry attempts, and deadlines.

```ts
const limited = new DataEngine({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxFrameBytes: 8 * 1024 * 1024,
  maxConcurrentOperations: 32,
  operationTimeoutMs: 30_000,
});
```

These are example limits, not all defaults. See [resource-limit details](docs/enterprise.md#resource-limits).

## Documentation

- [Complete public API reference](docs/api.md)
- [Architecture](docs/architecture.md)
- [Production operations and security](docs/enterprise.md)
- [Encryption v4 migration](docs/encryption-v4-migration.md)
- [Changelog](CHANGELOG.md)

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md), and [SECURITY.md](SECURITY.md). Report vulnerabilities privately according to the security policy, not in public issues.

MIT © Snyxex.
