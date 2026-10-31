# PipeX

PipeX is a typed Node.js data-transformation engine for composing compression, authenticated encryption, integrity checks, validation, and custom plugins across buffers, files, and streams.

## Requirements

- Node.js 22 or newer (Jenkins tests current 22.x, 24.x and 26.x)
- ESM (`"type": "module"`)

## Installation

The npm package is being prepared as `@snyxex/pipex`; publication and
scope ownership must be verified before installing it from the registry.

After publication:

```bash
npm install @snyxex/pipex
```

Until then, install the development version directly from this repository:

```bash
npm install github:Snyxex/PipeX
```

The older unscoped package `pipex` belongs to a different npm publisher.
Do not install it expecting this project.

## Quick start

```ts
import { randomBytes } from 'node:crypto';
import { DataEngine, CompressionPlugin, EncryptionPlugin } from '@snyxex/pipex';

const engine = new DataEngine({
  maxInputBytes: 64 * 1024 * 1024,
  operationTimeoutMs: 30_000,
})
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: randomBytes(32) }));

const result = await engine.binary.run({ id: 1, username: 'dev' });
const restored = await engine.binary.undo(result, { timeoutMs: 30_000 });
```

Keep encryption keys outside source control and load them from a secret manager or KMS in production.
Generic KMS adapters expose queryable operation capabilities and receive an
`AbortSignal` governed by the engine deadline. See
[Production operations](./docs/enterprise.md#encryption-and-key-management).

## Choosing the right API

| Use case | API | Notes |
| --- | --- | --- |
| Transform an object or buffer in memory | `binary.run()` / `binary.undo()` | Applies the configured plugin chain |
| Encode or decode MessagePack | `binary.pack()` / `binary.unpack()` | Serialization only; no plugins |
| Transform an existing file | `file.process()` / `file.reverse()` | Atomic output replacement and bounded streaming |
| Encode object frames to a file | `file.pack()` / `file.unpack()` | Serialization only; includes a manifest |
| Transform Node.js byte streams | `stream.pipe()` | Applies plugins with backpressure |
| Encode object streams | `stream.pack()` / `stream.unpack()` | Serialization only; includes a manifest |

`pack()` and `unpack()` never encrypt, compress, or hash. Use `run()`/`undo()`, `process()`/`reverse()`, or `stream.pipe()` for plugin transformations.

For results received over a transport or reconstructed from storage, specify an
application-owned type: `engine.binary.undo(received, { expectedType: 'object' })`.
Never derive `expectedType` or the raw-buffer `forceType` from untrusted metadata.
Locally produced results retain an implicit trusted type while their Buffer
identity is preserved. This tightens the decoding contract without changing the
ciphertext format; modified type metadata is rejected before decryption.

## Files

Output paths are constrained to `allowedRoot`. When it is omitted, PipeX uses the current working directory. Parent directories must already exist.

```ts
await engine.file.process('./data/input.bin', './data/input.pipex', './data', { timeoutMs: 60_000 });
await engine.file.reverse('./data/input.pipex', './data/restored.bin', './data');
```

PipeX rejects traversal, symlink escapes, special files, and identical or hard-linked
input/output files. File sessions acquire native handles before plugins run.
Windows uses root-relative opens and handle-based replacement; POSIX uses
no-follow directory-relative opens and a private temporary directory. Outputs
are replaced only after successful processing. Koffi supplies the native bindings
and is loaded only when using the file controller. Keep roots under the service
account's exclusive control; see [File-system boundary](./docs/enterprise.md#file-system-boundary).

## Streams and cancellation

```ts
import { createReadStream, createWriteStream } from 'node:fs';

const controller = new AbortController();
await engine.stream.pipe(
  createReadStream('./input.bin'),
  createWriteStream('./output.pipex'),
  false,
  { signal: controller.signal, timeoutMs: 30_000 },
);
```

Encryption streams use the versioned `PXAE` format and authenticate bounded
frames before releasing each frame. A final authenticated frame detects
truncation, while sequence numbers detect reordering and duplication. HMAC
verification still withholds the complete bounded message because its appended
digest authenticates the stream only at EOF.

`EncryptionPlugin` defaults to 64 KiB plaintext frames (constrained by
`maxFrameBytes`). Its v4 writer never emits the old unversioned format. The
legacy reader is enabled temporarily for migration and can be disabled with
`allowLegacyDecrypt: false`. See [Encryption v4 migration](./docs/encryption-v4-migration.md).

## Configuration

Built-in plugins are registered automatically:

```ts
const engine = await DataEngine.fromConfig({
  limits: { maxInputBytes: 32 * 1024 * 1024, operationTimeoutMs: 15_000 },
  logger,
  auditLogger,
  plugins: [
    { name: 'compression', options: { type: 'brotli', level: 5 } },
    { name: 'hashing', options: { algorithm: 'sha256', secret: process.env.PIPEX_HMAC_SECRET } },
  ],
});

console.log(engine.pipeline);
// ['compression@3.0.0', 'hashing@3.0.0']
```

Available names are `compression`, `encryption`, `hashing`, `benchmark`, `worker-pool`, `validation`, and `kms-encryption`. Options containing runtime objects, such as Zod schemas or KMS providers, must be supplied programmatically.

The local `worker-pool` plugin executes caller-owned worker module exports with
bounded threads, queue admission, task deadlines, and deterministic shutdown.
See [Local worker pools](./docs/enterprise.md#local-worker-pools).

`fromConfig()` also accepts `limits`, `logger`, `tracer`, `auditLogger`, `dlq`, `schema`, and `schemaRegistry`. `dlq` is the compatibility name for an optional caller-provided failure sink; PipeX does not persist or replay its contents. Integration objects are validated immediately so configuration mistakes fail during startup.

Register a custom plugin with `DataEngine.registerPlugin('redact', RedactPlugin)`.

`engine.plugins` and `engine.pipeline` return immutable snapshots. Configure the pipeline before starting work; `use()` rejects changes while any operation is active.

## Custom plugins

```ts
import { BasePlugin, type ProcessorContext } from '@snyxex/pipex';

class PrefixPlugin extends BasePlugin {
  readonly name = 'prefix';
  readonly version = '1.0.0';

  process(data: Buffer, _context: ProcessorContext): Buffer {
    return Buffer.concat([Buffer.from('PX:'), data]);
  }

  reverse(data: Buffer, _context: ProcessorContext): Buffer {
    return data.subarray(3);
  }
}
```

Plugins without `createStream()` use a chunk-based fallback. They must be safe to run independently for every stream chunk. Plugins that need whole-message semantics should implement a framed native stream or use the binary API.

## Operational hooks

PipeX supports structured logging, audit logging, tracing, progress events,
bounded retries, deadlines, concurrency limits, and an optional caller-provided
failure sink. The existing `dlq`/`setDlq()` names remain supported for
compatibility. See [Failure-sink semantics](./docs/enterprise.md#retries-and-caller-provided-failure-sink)
before routing potentially sensitive chunks. Observer callback failures are
isolated from data processing.

```ts
engine.setLogger(logger).setAuditLogger(auditLogger).on('error', (error, requestId) => {
  console.error({ requestId, error: error.message });
});
```

See [Architecture](./docs/architecture.md), [Production operations](./docs/enterprise.md), and [Encryption security and threat model](./docs/security.md).

## Development

Use Node.js 22 or newer with npm (Jenkins validates current Node.js 22, 24, and 26 releases).

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run quality:ci
npm audit --audit-level=high
npm pack --dry-run --json --ignore-scripts
```

`npm run quality:ci` executes the production typecheck, build, tooling, unit,
integration, security, package, consumer, and short performance suites.
Jenkins is the only configured CI system; the root `Jenkinsfile` tests PRs
and branches and archives an npm tarball but does not publish it.

For release planning see [Release procedure](docs/releasing.md) and
[Release readiness](docs/npm-release-readiness.md). Perform a full secret scan,
verify the npm publishing identity, and use a separately protected release job
before distributing any tarball.

Large throughput benchmarking is intentionally excluded from `npm test` and
CI. Run it manually with `npm run benchmark:large` and
`PIPEX_BENCHMARK_BYTES` as needed.

## License

MIT © Snyxex

## Contributing and security

- [Contributing guide](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security policy and responsible disclosure](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [Release preparation](docs/releasing.md)

Use GitHub issues for ordinary bugs and features, **not** for undisclosed vulnerabilities. Jenkins is the project CI system; no GitHub Actions workflows are configured.
