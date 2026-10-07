# PipeX

PipeX is a typed Node.js data-transformation engine for composing compression, authenticated encryption, integrity checks, validation, and custom plugins across buffers, files, and streams.

## Requirements

- Node.js 20 or newer
- ESM (`"type": "module"`)

## Installation

PipeX is not published to npm yet. Install it from the repository or consume a packed release artifact:

```bash
npm install github:Snyxex/PipeX
```

## Quick start

```ts
import { randomBytes } from 'node:crypto';
import { DataEngine, CompressionPlugin, EncryptionPlugin } from 'pipex';

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

Write a plugin without a class and attach it with `use()`:

```ts
import { DataEngine, definePlugin } from 'pipex';

const identity = definePlugin({
  name: 'identity', version: '1.0.0',
  process: data => data,
  reverse: data => data,
  streaming: true, // Identity is independent of chunk boundaries.
});
const engine = new DataEngine().use(identity);
```

For configurable plugins, export a factory and supply it locally:

```ts
const configured = await DataEngine.fromConfig({
  plugins: [{ name: 'prefix', options: { prefix: 'PX:' } }],
}, { prefix: createPrefixPlugin });
```

The complete `createPrefixPlugin` implementation and guidance for streams, typed
classes, retries and separate packages are in [Writing plugins](./docs/plugins.md).
Object-style plugins default to binary-only. Explicitly enable chunk-safe fallback
or implement `createStream()`. Existing classes and `registerPlugin()` remain
supported; `registerPluginFactory()` adds global factory registration.

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

See [Architecture](./docs/architecture.md) and [Production operations](./docs/enterprise.md).

## Development

```bash
npm ci
npm run quality:ci
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run test:package
npm run test:performance
npm run build
npm pack --dry-run
```

`npm test` performs the production TypeScript check, build, test-runner checks,
unit tests, integration tests, behavioral security regressions, and package
sanity checks. `test:performance` is a short CI-safe smoke suite.

`npm run quality:ci` is the local equivalent of the Jenkins quality job. It builds
once, runs every automated suite (including the short performance/backpressure
smoke tests), and validates the exact `npm pack --dry-run` payload. Jenkins runs this
sequence on Node.js 20.19.0 plus the latest Node.js 22 and 24 releases. Node
20.19.0 is the declared minimum; current releases are used for the other active
major lines so security and compatibility fixes are exercised continuously.
Jenkins installs with lifecycle scripts disabled, then invokes the trusted project
build and checks explicitly for better per-suite diagnostics. GitHub Actions remains
enabled until the first Jenkins Multibranch build is green, so the migration does not
create a CI gap.

The separate dependency-audit job checks runtime and development dependencies
with `npm audit --audit-level=high`. High and critical advisories are blocking;
moderate and low advisories remain visible in the report without failing CI.
See [Jenkins CI](./docs/jenkins.md) for job and agent requirements.

Large throughput work is intentionally excluded from `npm test` and CI. Run it
manually with `npm run benchmark:large`; set `PIPEX_BENCHMARK_BYTES` to override
its 1 GiB default within the guarded 1 MiB to 8 GiB range.

## License

MIT © Snyxex
