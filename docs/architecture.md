# PipeX architecture

## Components

`DataEngine` owns configuration, plugin order, limits, schema validation, observability hooks, and request lifecycle state. Its `binary`, `file`, and `stream` controllers expose APIs suited to each I/O model.

The configured plugin list is exposed only as an immutable snapshot. Pipeline mutation is rejected while operations are active, so execution and audit metadata cannot diverge during concurrent work.

Core helpers in `src/core/core.ts` implement serialization, retry behavior, manifests, byte/frame limits, path containment, and stream composition. Plugins implement transformations and optional reverse operations.

## Data paths

### Binary transformations

`binary.run(value)` converts the value to a buffer, applies plugins in registration order, and returns an `EngineResult`. `binary.undo(result, options)` applies reversible plugins in reverse order, honors cancellation and deadlines, and restores the original JavaScript type.

The `EngineResult.pipeline` field records the plugin identifiers used by the operation. It is metadata, not a cryptographic signature.

### File and raw-stream transformations

`file.process()` and `stream.pipe()` apply plugins in registration order. Reverse operations apply them in reverse order. File writes use a private temporary output followed by an atomic rename so a failed operation does not expose a partial destination.

Native plugin streams participate in Node.js backpressure. A plugin without `createStream()` is adapted per chunk; this fallback is only correct for transformations whose chunks can be processed independently.

`stream.into()` and `stream.reverseInto()` expose writable endpoints whose
`finish` event is delayed until the destination, internal pipeline, and audit
hook have completed. Source, transform, destination, and cancellation errors
therefore reach the calling `pipeline()` instead of becoming late background
failures.

### MessagePack framing

`binary.pack()`, `file.pack()`, and `stream.pack()` are serialization APIs. They do not apply the plugin chain.

File and stream packages begin with a versioned MessagePack manifest:

```ts
interface PipeXManifest {
  readonly __pipex_v: 1;
  readonly plugins: readonly string[];
  readonly ts: number;
}
```

The serialization-only format currently requires an empty `plugins` list.
Before decoding, a structural scanner enforces the configured byte limit at each
top-level MessagePack frame, including across fragmented length headers. It also
rejects declared lengths and container counts that cannot fit in the remaining
frame budget. Aggregate input/output limits and application-frame counts are
enforced separately.

## Security boundaries

- Input, output, frame, retry, timeout, and concurrency limits are enforced by the engine.
- File paths are resolved against an allowed root using real filesystem paths.
- AES-GCM, ChaCha20-Poly1305, and HMAC verification do not release plaintext before authentication succeeds.
- Authentication verification buffers plaintext up to the configured bound. This prevents unauthenticated data exposure, but it is not constant-memory processing.
- KMS envelope keys are validated and plaintext data keys are zeroed after use.
- Event-listener failures are isolated; audit logger failures remain visible to the caller.

PipeX does not provide HTTP authentication, authorization, tenant isolation, secret storage, or network policy. The embedding application owns those boundaries.

## Performance model

- MessagePack serialization uses `msgpackr`.
- File and raw-stream paths use Node.js pipeline backpressure.
- Buffer slicing uses `subarray()` where ownership permits it.
- HMAC verification performs one bounded aggregate allocation instead of repeated growing concatenations.
- Binary compression uses asynchronous native Zlib/Brotli work so CPU-heavy compression does not block the event loop. Stream APIs remain preferable for payloads that should not be held entirely in memory.

## Plugin contract

```ts
interface ProcessorPlugin {
  readonly name: string;
  readonly version: string;
  readonly reversible?: boolean;
  readonly streaming?: boolean;
  retryOptions?: RetryOptions;
  process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress', context?: StreamPluginContext): Duplex;
}
```

Capabilities are normalized and validated by `getPluginCapabilities(plugin)` and
can be queried with `supportsOperation(plugin, 'process' | 'reverse' | 'stream')`.
For registered pipelines, `engine.pluginCapabilities` returns an immutable view
in execution order. `streamMode` distinguishes native plugin streams from the
per-chunk fallback adapter and plugins that reject streaming entirely.

`reversible: true` requires a real `reverse()` implementation. Omitting
`reversible` derives support from the implementation; setting it to `false`
allows configuration-dependent plugins to disable an otherwise present method.
Likewise, `streaming: false` must not be combined with `createStream()`. Invalid
declarations fail during `engine.use()` with `InvalidPluginCapabilityError`.

A reversible pipeline requires every plugin to support `reverse()`. Unsupported
operations fail before any reverse plugin is executed with
`UnsupportedReverseError`; the default `BasePlugin.reverse()` also throws that
typed error and never returns the input as a successful result.
