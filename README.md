# PipeX

**Composable data processing for Node.js — secure, streaming, and extensible.**

PipeX is a TypeScript-first data-transformation engine for applications that need to serialize, compress, encrypt, validate, and process data without tying those operations to a specific transport or storage provider. Configure a pipeline once, then use it with in-memory values, files, or Node.js streams.

Built for backend services, data pipelines, internal tooling, and systems that exchange or persist binary payloads.

## Highlights

- **Composable plugins:** Combine compression, authenticated encryption, HMAC integrity, validation, benchmarking, and your own processors.
- **Three data interfaces:** Work with objects and buffers, files, or streams using one configured engine.
- **Streaming with backpressure:** Process large inputs without treating every payload as a single in-memory buffer.
- **Security-oriented defaults:** Authenticated encryption, bounded inputs and frames, timeouts, cancellation, and explicit decoding controls.
- **Operational visibility:** Structured logging, tracing, audit hooks, progress notifications, bounded retries, and a caller-supplied failure sink.
- **Extensible runtime:** Custom plugins, configuration-based pipelines, local worker pools, and application-provided KMS adapters.
- **Typed ESM package:** TypeScript declarations and support for Node.js 22, 24, and 26.

PipeX is a **processing engine**, not a message broker, database, object store, or network transport. You control where data comes from, where it goes, and how it is retained.

## Install

```bash
npm install @snyxex/pipex
```

**Requirements:** Node.js 22 or newer; ESM.

> The unrelated, unscoped npm package `pipex` is not this project. Install `@snyxex/pipex`.

## Quick start

```ts
import { randomBytes } from 'node:crypto';
import {
  DataEngine,
  CompressionPlugin,
  EncryptionPlugin,
} from '@snyxex/pipex';

const engine = new DataEngine({
  maxInputBytes: 64 * 1024 * 1024,
  operationTimeoutMs: 30_000,
})
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({
    algorithm: 'aes-256-gcm',
    key: randomBytes(32),
  }));

const encoded = await engine.binary.run({ id: 1, event: 'created' });
const decoded = await engine.binary.undo(encoded);
```

**Production note:** Keep encryption keys in your application's secret manager or KMS. Do not generate a new key per request when the data must be decryptable later.

## How you can use PipeX

| Scenario | PipeX capability |
| --- | --- |
| Protect serialized application data | Compose compression and authenticated encryption for binary payloads |
| Process files in backend services | Atomic file transformations with bounded streaming and file-system safeguards |
| Transform Node.js streams | Apply plugin pipelines with backpressure, cancellation, and deadlines |
| Exchange structured payloads | MessagePack serialization for supported object types |
| Enforce application-specific rules | Register custom validation or processing plugins |
| Run CPU-heavy local transforms | Bounded worker pools with queue controls and shutdown behavior |
| Integrate production infrastructure | Add tracing, audit logging, custom KMS providers, and caller-owned failure sinks |

## One engine, multiple interfaces

| Interface | Operations | Purpose |
| --- | --- | --- |
| **Binary** | `binary.run()`, `binary.undo()` | Apply and reverse configured transforms on in-memory data |
| **Files** | `file.process()`, `file.reverse()` | Transform files, with controlled output boundaries |
| **Streams** | `stream.pipe()` | Transform Node.js byte streams with backpressure |
| **Serialization** | `binary.pack()`, `binary.unpack()`, `file.pack()`, `file.unpack()`, `stream.pack()`, `stream.unpack()` | Encode and decode MessagePack without applying plugins |

**Important:** `pack()` and `unpack()` perform serialization only. They do **not** compress, encrypt, or hash data.

### Stream processing

```ts
import { createReadStream, createWriteStream } from 'node:fs';

const abort = new AbortController();

await engine.stream.pipe(
  createReadStream('./input.bin'),
  createWriteStream('./output.pipex'),
  false,
  { signal: abort.signal, timeoutMs: 30_000 },
);
```

### File processing

```ts
await engine.file.process(
  './data/input.bin',
  './data/input.pipex',
  './data',
  { timeoutMs: 60_000 },
);

await engine.file.reverse(
  './data/input.pipex',
  './data/restored.bin',
  './data',
);
```

The final root argument defines the permitted file-system boundary. PipeX checks traversal and link conditions and uses atomic output replacement; keep the root under the service account's control.

## Plugins and configuration

Built-in plugin families include compression, encryption, hashing, validation, benchmarking, KMS encryption, and local worker pools. Add your own plugin with `BasePlugin`, or register it for configuration-driven pipelines.

```ts
import { BasePlugin, DataEngine } from '@snyxex/pipex';

class PrefixPlugin extends BasePlugin {
  readonly name = 'prefix';
  readonly version = '1.0.0';

  process(data: Buffer): Buffer {
    return Buffer.concat([Buffer.from('PX:'), data]);
  }

  reverse(data: Buffer): Buffer {
    return data.subarray(3);
  }
}

const customEngine = new DataEngine().use(new PrefixPlugin());
```

For stream use, chunk-based custom plugins must be independently safe on every chunk. Implement a framed stream protocol if the transformation requires whole-message semantics.

## Reliability and security

PipeX supports size limits, operation deadlines, cancellation, bounded concurrency, error classification, audit hooks, and authenticated stream framing. Encrypted streams authenticate each bounded frame before releasing its plaintext; a final authentication frame detects truncation.

When reversing data received from outside your process, provide an application-owned expected type rather than trusting type hints from the payload. For deployments that process sensitive data, review the production security guidance before shipping.

PipeX does **not** provide built-in durable queues, automatic replay, scheduling, or key storage. The optional `dlq` interface is a caller-provided failure sink.

## Documentation

- [Architecture and design](docs/architecture.md)
- [Production configuration, security, and operations](docs/enterprise.md)
- [Encryption format migration](docs/encryption-v4-migration.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security policy](SECURITY.md)

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run quality:ci
npm audit --audit-level=high
```

The quality suite includes TypeScript checks, builds, tooling, unit, integration, security, package, consumer, and performance smoke tests. See [maintainer release documentation](docs/releasing.md) for the protected Jenkins release process.

## License

MIT © Snyxex
