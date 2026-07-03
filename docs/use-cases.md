# Use Cases

This guide describes the main PipeX workflows and when to use each one.

## 1. Transform Small In-Memory Data

Use `engine.binary.run()` when the full payload fits comfortably in memory.

```ts
const engine = new DataEngine()
  .use(new Plugins.Compression({ type: 'gzip' }));

const result = await engine.binary.run({ message: 'hello' });
const original = await engine.binary.undo<{ message: string }>(result);
```

Use this for API payloads, jobs, command output, structured messages, and small documents.

## 2. Compress Data

Use `CompressionPlugin` to reduce payload size. PipeX supports `gzip`, `brotli`, and `none`.

```ts
const engine = new DataEngine()
  .use(new Plugins.Compression({ type: 'brotli', level: 6 }));
```

Use Brotli for high compression ratios and gzip for broad compatibility and speed.

## 3. Encrypt Data

Use `EncryptionPlugin` when transformed data must be confidential.

```ts
import { randomBytes } from 'node:crypto';

const engine = new DataEngine()
  .use(new Plugins.Encryption({
    algorithm: 'aes-256-gcm',
    key: randomBytes(32),
  }));
```

Supported algorithms are `aes-256-gcm` and `chacha20-poly1305`. Keys must be 32 bytes.

## 4. Verify Data Integrity

Use `HashingPlugin` to append and verify an HMAC.

```ts
const engine = new DataEngine()
  .use(new Plugins.Hashing({
    algorithm: 'sha256',
    secret: 'at-least-16-characters',
  }));
```

Use this when you need tamper detection. If the payload is changed, `undo()` throws.

## 5. Build a Full Secure Pipeline

Plugins run in the order they are registered.

```ts
const engine = new DataEngine()
  .use(new Plugins.Compression({ type: 'brotli' }))
  .use(new Plugins.Hashing({
    algorithm: 'sha256',
    secret: 'at-least-16-characters',
  }))
  .use(new Plugins.Encryption({
    algorithm: 'aes-256-gcm',
    key,
  }));

const result = await engine.binary.run(payload);
const restored = await engine.binary.undo<typeof payload>(result);
```

On undo, PipeX reverses the plugin order: decrypt, verify HMAC, then decompress.

## 6. Validate Structured Data

Use `DataEngine#setSchema()` for global input and output validation.

```ts
import { z } from 'zod';

const User = z.object({
  id: z.number(),
  email: z.string().email(),
});

const engine = new DataEngine().setSchema(User);
await engine.binary.run({ id: 1, email: 'user@example.com' });
```

Use this when the engine should reject invalid data before transformation and after restoration.

## 7. Validate Inside a Plugin Chain

Use `Plugins.Validation` when validation should be part of a reusable pipeline.

```ts
const engine = new DataEngine()
  .use(new Plugins.Validation({
    schema: User,
    validateOnReverse: true,
  }));
```

This plugin expects MsgPack-encoded structured data, which is the default binary representation PipeX uses for objects and arrays.

## 8. Process Large Files

Use `engine.file.process()` and `engine.file.reverse()` for file-to-file streaming.

```ts
await engine.file.process('input.json', 'output.pipex');
await engine.file.reverse('output.pipex', 'restored.json');
```

Use this for large files where loading the whole payload into memory is undesirable.

## 9. Restrict File Access to a Root Directory

Pass `allowedRoot` to deny path traversal outside a known directory.

```ts
await engine.file.process(
  'uploads/input.bin',
  'out/result.pipex',
  '/var/app/uploads',
);
```

Use this for user-provided file paths.

## 10. Pack and Unpack Files with Manifests

Use file packing when you want MsgPack framing and a manifest header.

```ts
await engine.file.pack('data.json', 'data.msgpack');
await engine.file.unpack('data.msgpack', 'data.ndjson');
```

The manifest records the plugin chain and is emitted through the `manifest` event during unpacking.

## 11. Serialize and Deserialize Values

Use `engine.binary.pack()` and `engine.binary.unpack()` for fast MsgPack conversion without running plugins.

```ts
const packed = engine.binary.pack({ id: 1 });
const value = engine.binary.unpack<{ id: number }>(packed);
```

Use this when you only need binary serialization.

## 12. Attach a Manifest to In-Memory Data

Use `packWithManifest()` when data will travel between systems and should carry pipeline metadata.

```ts
const packed = engine.binary.packWithManifest({ payload: 'data' });
const { manifest, data } = engine.binary.unpackWithManifest(packed);
```

Use this for transport formats, debugging, or compatibility checks.

## 13. Pipe Live Streams

Use `engine.stream.pipe()` when you already have Node.js `Readable` and `Writable` streams.

```ts
await engine.stream.pipe(readable, writable);
await engine.stream.pipe(encryptedReadable, restoredWritable, true);
```

The third argument reverses the pipeline.

## 14. Create a Writable Pipeline Endpoint

Use `engine.stream.into()` when callers should pipe data into PipeX.

```ts
source.pipe(engine.stream.into(destination));
```

Use this when integrating with existing stream-based APIs.

## 15. Reverse a Writable Pipeline Endpoint

Use `engine.stream.reverseInto()` to create a writable endpoint for reverse processing.

```ts
encryptedSource.pipe(engine.stream.reverseInto(destination));
```

Use this for decrypt/decompress/verify stream flows.

## 16. Pack and Unpack Object Streams

Use `engine.stream.pack()` and `engine.stream.unpack()` for MsgPack object stream framing.

```ts
objectReadable
  .pipe(engine.stream.pack())
  .pipe(byteWritable);

byteReadable
  .pipe(engine.stream.unpack())
  .on('data', (value) => console.log(value));
```

Use this for streaming object transport over sockets, files, or queues.

## 17. Offload CPU Work to Worker Threads

Use `WorkerPoolPlugin` for CPU-heavy transformations.

```ts
const engine = new DataEngine()
  .use(new Plugins.WorkerPool({ maxThreads: 2 }));
```

The built-in worker plugin currently demonstrates XOR processing. It is useful as a template for custom worker-backed transformations.

## 18. Collect Pipeline Metrics

Use `BenchmarkPlugin` to record byte and duration metadata during processing.

```ts
const engine = new DataEngine()
  .use(new Plugins.Benchmark())
  .use(new Plugins.Compression({ type: 'gzip' }));
```

Use this when you need per-step timing from `EngineResult.metrics`.

## 19. Listen to Engine Events

Use events for lifecycle hooks and progress reporting.

```ts
engine.on('start', (requestId) => {});
engine.on('plugin:after', (name, durationMs) => {});
engine.on('progress', (bytes, requestId) => {});
engine.on('end', (requestId, durationMs) => {});
engine.on('error', (error, requestId) => {});
engine.on('manifest', (manifest) => {});
```

Use this for dashboards, logs, progress bars, and debugging.

## 20. Add Logging and Tracing

Use `setLogger()` and `setTracer()` to integrate with observability tools.

```ts
engine.setLogger(logger);
engine.setTracer(tracer);
```

Use this with Pino, Winston, OpenTelemetry-compatible tracers, or your own adapter.

## 21. Record Audit Events

Use `setAuditLogger()` to receive audit records for binary process and reverse operations.

```ts
engine.setAuditLogger({
  async log(record) {
    await writeAuditRecord(record);
  },
});
```

Use this for compliance logs, security review, and operation history.

## 22. Retry Flaky Plugins

Plugins can expose `retryOptions`.

```ts
const plugin = {
  name: 'remote-plugin',
  version: '1.0.0',
  retryOptions: { attempts: 3, backoff: 'fixed', delayMs: 100 },
  async process(data, ctx) {
    return data;
  },
};
```

Use retries for transient plugin failures, such as remote calls or temporary resource contention.

## 23. Use a Dead Letter Queue

Use `setDlq()` with stream pipelines to divert failed chunks instead of crashing the main pipeline.

```ts
engine.setDlq(deadLetterWritable);
await engine.stream.pipe(input, output);
```

Use this for resilient stream processing where bad chunks should be stored for later inspection.

## 24. Bootstrap from Configuration

Use `DataEngine.registerPlugin()` and `DataEngine.fromConfig()` to create engines from config objects.

```ts
DataEngine.registerPlugin('compression', Plugins.Compression);

const engine = await DataEngine.fromConfig({
  plugins: [
    { name: 'compression', options: { type: 'gzip' } },
  ],
});
```

Use this for apps that load pipelines from config files or service settings.

## 25. Load Schemas from a Registry

Use `setSchemaRegistry()` and `loadSchema()`.

```ts
engine.setSchemaRegistry(registry);
await engine.loadSchema('user', 3);
```

Use this when schemas are centrally managed.

## 26. Write a Custom Plugin

Implement `ProcessorPlugin`.

```ts
const uppercasePlugin = {
  name: 'uppercase',
  version: '1.0.0',
  process: (data) => Buffer.from(data.toString().toUpperCase()),
  reverse: (data) => Buffer.from(data.toString().toLowerCase()),
};

engine.use(uppercasePlugin);
```

Use custom plugins for domain-specific transforms, redaction, encoding, signing, enrichment, or adapters.

## 27. Publish a Package Build

Use the build script before publishing.

```bash
npm run typecheck
npm run build
npm test
```

The package entry point is `dist/index.mjs`. The worker-pool artifact `dist/worker_piscina.mjs` must be present for `WorkerPoolPlugin`.
