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
const restored = await engine.binary.undo(result);
```

Keep encryption keys outside source control and load them from a secret manager or KMS in production.

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

## Files

Output paths are constrained to `allowedRoot`. When it is omitted, PipeX uses the current working directory. Parent directories must already exist.

```ts
await engine.file.process('./data/input.bin', './data/input.pipex', './data', { timeoutMs: 60_000 });
await engine.file.reverse('./data/input.pipex', './data/restored.bin', './data');
```

PipeX rejects traversal, symlink escapes, and identical input/output files. Outputs are written to a private temporary file and renamed after successful completion.

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

Authenticated decryption and HMAC verification withhold plaintext until authentication succeeds. These verification paths buffer data up to the configured hard limit; they are not constant-memory streams.

## Configuration

Built-in plugins are registered automatically:

```ts
const engine = await DataEngine.fromConfig({
  plugins: [
    { name: 'compression', options: { type: 'brotli', level: 5 } },
    { name: 'hashing', options: { algorithm: 'sha256', secret: process.env.PIPEX_HMAC_SECRET } },
  ],
});

console.log(engine.pipeline);
// ['compression@3.0.0', 'hashing@3.0.0']
```

Available names are `compression`, `encryption`, `hashing`, `benchmark`, `worker-pool`, `validation`, and `kms-encryption`. Options containing runtime objects, such as Zod schemas or KMS providers, must be supplied programmatically.

Register a custom plugin with `DataEngine.registerPlugin('redact', RedactPlugin)`.

## Custom plugins

```ts
import { BasePlugin, type ProcessorContext } from 'pipex';

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

PipeX supports structured logging, audit logging, tracing, progress events, bounded retries, deadlines, concurrency limits, and a writable dead-letter stream. Observer callback failures are isolated from data processing.

```ts
engine.setLogger(logger).setAuditLogger(auditLogger).on('error', (error, requestId) => {
  console.error({ requestId, error: error.message });
});
```

See [Architecture](./docs/architecture.md) and [Production operations](./docs/enterprise.md).

## Development

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

`npm test` performs the production TypeScript check and compiled hardening regression suite.

## License

MIT © Snyxex
