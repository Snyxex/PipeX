# PipeX public API reference

This reference describes the source exports of `@snyxex/pipex` at **1.0.2**. Signatures are adapted from the TypeScript source for readability; follow the published `.d.mts` declarations for complete type inference. Import these APIs from `@snyxex/pipex`. The package also exposes `@snyxex/pipex/plugins/kms`, currently mapped to the same compiled entry point.

## Entry points and results

```ts
class DataEngine {
  constructor(limits?: Partial<EngineLimits>);
  static registerPlugin<TOptions>(name: string, pluginClass: PluginConstructor<TOptions>): void;
  static fromConfig(config: EngineConfig): Promise<DataEngine>;
  readonly binary: BinaryController;
  readonly file: FileController;
  readonly stream: StreamController;
  use(plugin: ProcessorPlugin): this;
  get plugins(): readonly ProcessorPlugin[];
  get pipeline(): readonly string[];
  get pluginCapabilities(): readonly Readonly<RegisteredPluginCapabilities>[];
  get limits(): Readonly<EngineLimits>;
  setLimits(limits: Partial<EngineLimits>): this;
}
interface EngineResult {
  readonly data: Buffer;
  readonly originalType: string;
  readonly pipeline: string[];
  readonly metrics: { durationMs: number; steps: Record<string, number> };
}
interface OperationOptions { signal?: AbortSignal; timeoutMs?: number }
interface BinaryUndoOptions extends OperationOptions { expectedType?: string }
```

`new DataEngine()` creates an empty plugin pipeline. `use()` appends a plugin and returns the engine; it validates plugin capabilities and rejects changing a pipeline while operations are active. `registerPlugin()` maps a name to a constructor used by `fromConfig()`. `fromConfig()` applies registered plugin names and options, limits, and integrations; unknown plugin names or invalid configurations reject or throw. `plugins`, `pipeline`, `pluginCapabilities`, and `limits` expose immutable snapshots. `setLimits()` rejects invalid settings and changes during active requests.

A pipeline runs forward in registration order, reverse in opposite order. Reverse operations fail before executing a non-reversible chain.

## Binary controller

```ts
engine.binary.pack(data: unknown): Buffer;
engine.binary.unpack<T = unknown>(input: Buffer | Uint8Array): T;
engine.binary.run(input: unknown, options?: OperationOptions): Promise<EngineResult>;
engine.binary.undo<T = unknown>(result: EngineResult, options?: BinaryUndoOptions): Promise<T>;
engine.binary.undo<T = unknown>(input: Buffer, forceType: string, options?: OperationOptions): Promise<T>;
engine.binary.packWithManifest(data: unknown): Buffer;
engine.binary.unpackWithManifest<T = unknown>(input: Buffer): {
  manifest: PipeXManifest;
  data: T;
};
```

- `pack` and `unpack` synchronously encode and decode one supported MessagePack value; they do **not** execute plugins. Malformed input and frame/byte-limit violations throw.
- `run` serializes or converts an in-memory input as necessary, executes plugins in order, and returns processed bytes together with metrics and a non-authenticated description of the pipeline. Plugin errors, cancellation, and limits reject the promise.
- `undo` reverses the configured chain. A locally produced `EngineResult` retains trusted type identity only while its original buffer identity is preserved. For a reconstructed/received result, provide an application-controlled `expectedType`. With raw Buffer input, `forceType` is mandatory and must come from trusted application configuration, not untrusted payload metadata. Type mismatches and non-reversible chains reject.
- `packWithManifest` encodes a versioned manifest frame followed by one value frame, with no transformation plugins configured; otherwise it throws.
- `unpackWithManifest` decodes exactly the expected framed profile into a `manifest` and `data` object, rejecting invalid manifests or framing.

## File controller

```ts
engine.file.process(inputPath: string, outputPath: string, allowedRoot?: string, options?: OperationOptions): Promise<void>;
engine.file.reverse(inputPath: string, outputPath: string, allowedRoot?: string, options?: OperationOptions): Promise<void>;
engine.file.pack(inputPath: string, outputPath: string, allowedRoot?: string, options?: OperationOptions): Promise<void>;
engine.file.unpack(inputPath: string, outputPath: string, allowedRoot?: string, options?: OperationOptions): Promise<void>;
```

All functions take input/output filesystem paths; `allowedRoot` constrains permitted paths, defaulting to the working directory. `options` provides cancellation and timeout. All return `Promise<void>` on successful, complete writes. `process` applies the chain; `reverse` reverses it; `pack` and `unpack` are **serialization-only** (the unpack output is NDJSON). Existing output is replaced atomically only after successful processing. Invalid root containment, special files, symlink/reparse escapes, hard-linked input/output aliases, missing parents, native binding errors, audit failures, aborts, and failed transforms reject.

The file controller uses native bindings via Koffi; it does not silently fall back to unsafe path-only access.

## Stream controller

```ts
engine.stream.pipe(
  source: Readable,
  destination: Writable,
  reverse?: boolean,
  options?: OperationOptions,
): Promise<void>;
engine.stream.into(destination: Writable, options?: OperationOptions): Writable;
engine.stream.reverseInto(destination: Writable, options?: OperationOptions): Writable;
engine.stream.pack(options?: OperationOptions): Duplex;
engine.stream.unpack(options?: OperationOptions): Duplex;
```

`pipe` resolves after the source, plugin chain, destination, and awaited audit hooks finish. It rejects on source, destination, transform, audit, timeout, or cancellation failure. Set `reverse=true` to reverse plugin order and direction.

`into` and `reverseInto` return writable endpoints for standard Node.js `pipeline()` / `pipe()` composition, delaying their finish notification until internal work and destination completion. Errors are emitted by the writable adapter, not returned as promises.

`pack` returns an object-input/byte-output Duplex with a serialization-only manifest. `unpack` returns a byte-input/object-output Duplex. Use `pipeline()` or error listeners; async audit errors after readable completion can be reported through the engine's error event.

## Engine configuration, hooks, and events

```ts
interface EngineConfig {
  plugins?: { name: string; options?: unknown }[];
  limits?: Partial<EngineLimits>;
  logger?: Logger;
  tracer?: Tracer;
  auditLogger?: AuditLogger;
  dlq?: Writable;
  schema?: import('zod').z.ZodType<any>;
  schemaRegistry?: SchemaRegistry;
}

interface EngineLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxFrameBytes: number;
  maxFrames: number;
  maxConcurrentOperations: number;
  operationTimeoutMs: number;
  maxRetryAttempts: number;
  maxRetryDelayMs: number;
  maxKmsEncryptedKeyBytes: number;
  maxKmsKeyIdBytes: number;
}
```

```ts
engine.setDlq(stream: Writable): this;
engine.setLogger(logger: Logger): this;
engine.setTracer(tracer: Tracer): this;
engine.setAuditLogger(logger: AuditLogger): this;
engine.setSchemaRegistry(registry: SchemaRegistry): this;
engine.loadSchema(subject: string, version?: number): Promise<void>;
engine.setSchema(schema: import('zod').z.ZodType<any>): this;
engine.validate(data: unknown): void;
engine.createOperationSignal(options?: OperationOptions): AbortSignal;
engine.emitAudit(record: Omit<AuditRecord, 'pluginChain' | 'timestamp'>): Promise<void>;
```

`setDlq` accepts a caller-owned writable failure sink, not a durable queue. `loadSchema` resolves a Zod schema via the provided registry; `validate` throws on schema failure. `createOperationSignal` produces a deadline-aware signal. `emitAudit` awaits the configured audit sink and propagates its errors. Logging and event-listener failures are isolated from transformation work.

The engine also exposes typed EventEmitter listeners for `start`, `plugin:after`, `progress`, `error`, `end`, and `manifest`. Operations invoke request lifecycle helpers, which are public on `DataEngine`: `startRequest(metadata?)`, `trackWork(requestId, pending)`, `releaseRequest(requestId)`, `endRequest(requestId, durationMs?)`, `emitProgress(bytes, requestId)`, and `emitError(err, requestId)`. These primarily support controller/plugin integration, not application-level scheduling.

## Plugins

```ts
interface ProcessorPlugin {
  readonly name: string;
  readonly version: string;
  readonly reversible?: boolean;
  readonly streaming?: boolean;
  retryOptions?: RetryOptions;
  process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress', context?: StreamPluginContext): Duplex;
}

interface RetryOptions {
  attempts: number;
  backoff: 'exponential' | 'fixed';
  delayMs: number;
}

interface PluginCapabilities {
  readonly process: true;
  readonly reverse: boolean;
  readonly streaming: boolean;
  readonly streamMode: 'native' | 'fallback' | 'none';
}
```

`BasePlugin` provides the base plugin contract; its default reverse behavior is fail-closed. Capability declarations are checked at registration. Plugins without `createStream` can use the per-chunk fallback only if independent transformation of every chunk is correct.

### Constructors and options

```ts
new CompressionPlugin(options: { type: 'gzip' | 'brotli' | 'none'; level?: number });
new EncryptionPlugin(options: {
  algorithm: 'aes-256-gcm' | 'chacha20-poly1305';
  key: Buffer;
  frameSizeBytes?: number;
  allowLegacyDecrypt?: boolean;
});
new HashingPlugin(options: { algorithm: 'sha256' | 'sha512'; secret: string });
new WorkerPoolPlugin(options: {
  filename: string | URL;
  processName?: string;
  reverseName?: string;
  maxThreads?: number;
  maxQueue?: number;
  taskTimeoutMs?: number;
  closeTimeoutMs?: number;
});
new ValidationPlugin(options: { schema: import('zod').z.ZodType<any>; validateOnReverse?: boolean });
new BenchmarkPlugin();
new KmsEncryptionPlugin(options: {
  kms: KmsProvider;
  keyId: string;
  allowLegacyDecrypt?: boolean;
});
```

`CompressionPlugin` rejects unknown compression types and levels outside gzip 0–9/Brotli 0–11. `EncryptionPlugin` rejects non-32-byte keys, unsupported algorithms, and invalid frame/legacy options. `HashingPlugin` requires a secret of at least 16 characters and supports **keyed HMAC**, not a plain digest. `WorkerPoolPlugin` runs caller-owned worker exports, rejects admission beyond bounds, and has `close(options?: {force?: boolean}): Promise<void>`. `KmsEncryptionPlugin` is binary-only and validates provider capabilities.

Also exported: `BenchmarkPlugin`, `ValidationPlugin`, `Plugins`, and plugin option types `CompressionOptions`, `CompressionType`, `EncryptionOptions`, `EncryptionAlgorithm`, `HashingOptions`, `HashAlgorithm`, `WorkerPoolOptions`, `ValidationOptions`, and `KmsEncryptionOptions`.

### KMS contract

```ts
type KmsOperation = 'encrypt' | 'decrypt' | 'generateDataKey';

interface KmsProvider {
  readonly capabilities?: Partial<KmsProviderCapabilities>;
  encrypt?(data: Buffer, keyId: string, options?: KmsRequestOptions): Promise<Buffer>;
  decrypt?(data: Buffer, keyId: string, options?: KmsRequestOptions): Promise<Buffer>;
  generateDataKey?(
    keyId: string,
    options?: KmsRequestOptions
  ): Promise<{ plaintext: Buffer; ciphertext: Buffer }>;
}
interface KmsRequestOptions { signal?: AbortSignal }
```

`getKmsProviderCapabilities(provider)` returns a validated capability view and `supportsKmsOperation(provider, operation)` tests support. Explicitly disabled capabilities prevent calls even when a compatibility method stub exists; a claimed supported capability with no method throws.

## Other exported helpers

The root also re-exports internal building blocks from `src/core/core.ts`, which remain callable public named exports: `withRetry`, `PIPEX_MANIFEST_KEY`, `PACKR`, `UNPACKR`, `MAX_FRAME_BYTES`, `DEFAULT_HIGH_WATER`, `DEFAULT_LIMITS`, `hasStreamSupport`, `getPluginCapabilities`, `supportsOperation`, `supportsReverse`, `assertReversiblePipeline`, `assertStreamingPipeline`, `detectType`, `toBuffer`, `ORIGINAL_TYPES`, `assertOriginalType`, `fromBuffer`, `makeContext`, `buildManifest`, `buildManifestHeaderTransform`, `buildManifestExtractTransform`, `GuardedUnpackrStream`, `createPackrStream`, `createUnpackrStream`, `buildByteLimitTransform`, `buildObjectLimitTransform`, `assertKnownValueByteLimit`, `buildKnownValueByteLimitTransform`, `buildFallbackTransform`, `buildNdjsonTransform`, `buildTransformChain`, `runPipeline`, `assertExists`, `resolveOutputPath`, `assertMessagePackFrameLimits`, and `buildFrameLimitTransform`.

These are low-level utilities rather than the recommended application facade. Their exact argument types are defined by the shipped TypeScript declarations and source; use controller methods for application workflows.

`isManifest(value: unknown): value is PipeXManifest` tests the structural shape of a PipeX manifest.

## Error classes and failure behavior

`PipeXError` exposes a typed `code: PipeXErrorCode`. Typed exports are:

- `UnsupportedReverseError`, `UnsupportedStreamingError`, `InvalidPluginCapabilityError`.
- `OperationAbortedError`, `OperationTimeoutError`.
- `KmsProviderError`, `KmsAuthenticationError`, `KmsProviderAuthenticationError`, `KmsProviderUnavailableError`, `UnsupportedKmsOperationError`, `InvalidKmsProviderCapabilityError`.
- `WorkerPoolClosedError`, `WorkerPoolCloseError`, `WorkerQueueFullError`, `WorkerTaskError`.

These classes reject unsupported operations, invalid capabilities, deadlines, cancelled requests, KMS authentication/provider faults, and worker lifecycle faults. Invalid input, malformed MessagePack, exceeded sizes, path rejection, compression errors, and HMAC mismatch may throw ordinary `Error` instances; not every failure is a `PipeXError`. Never log sensitive payload bytes or private keys when handling errors.

## Versioning and format compatibility

- The file/stream serialization-only manifest currently uses `__pipex_v: 1`.
- Encrypted data uses the versioned `PXAE` v4 framed format; legacy v3 decryption is opt-in by configuration after disabling default migration compatibility (`allowLegacyDecrypt: false`).
- The worker stream transport uses `PXWK` v1 frames; incompatible historical unframed streams must be migrated by the old application.
- The KMS envelope uses the `PXKM` format with an explicit legacy migration option.
- Persisted transformed data requires the same logical plugin order, compatible formats, and the appropriate keys to reverse.

The `PXAE` header has its own wire-format version; the plugin implementation is version 4.0.0. These are separate version values. The presence of a version number does not guarantee that every future release will support every historical format.

## Resource and security guidance

See [production operations](enterprise.md), [architecture](architecture.md), and [encryption migration](encryption-v4-migration.md). Prefer explicit operation limits and timeouts, native streams for large payloads, private filesystem roots, and external key storage. `piscina` and `koffi` are regular dependencies even though worker and native-file usage is opt-in at runtime.
