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

## Low-level root exports

These utilities are exported through the package root even though the controller facade is preferable for most application code. Signatures below reflect the implementation; `Readable`, `Writable`, `Duplex`, and `Transform` are Node.js stream types. Validation errors typically throw synchronously; stream processing failures are emitted or reject an awaited pipeline.

### Plugin capabilities and retries

```ts
function withRetry<T>(
  fn: () => Promise<T> | T,
  options?: RetryOptions,
  logger?: Logger,
  control?: {
    signal?: AbortSignal;
    limits?: Pick<EngineLimits, 'maxRetryAttempts' | 'maxRetryDelayMs'>;
    track?: (pending: Promise<unknown>) => void;
  },
): Promise<T>;

function hasStreamSupport(plugin: ProcessorPlugin): plugin is ProcessorPlugin & {
  createStream(mode: 'compress' | 'decompress', context?: StreamPluginContext): Duplex;
};
function getPluginCapabilities(plugin: ProcessorPlugin): Readonly<PluginCapabilities>;
function supportsOperation(plugin: ProcessorPlugin, operation: PluginOperation): boolean;
function supportsReverse(plugin: ProcessorPlugin): plugin is ProcessorPlugin & Required<Pick<ProcessorPlugin, 'reverse'>>;
function assertReversiblePipeline(plugins: readonly ProcessorPlugin[]): void;
function assertStreamingPipeline(plugins: readonly ProcessorPlugin[]): void;
```

`withRetry` invokes a synchronous or asynchronous operation with bounded fixed/exponential backoff, returns its eventual result, and rejects when attempts are exhausted, arguments are invalid, or the request is cancelled. `hasStreamSupport` checks whether a native stream factory exists; `getPluginCapabilities` validates the declared/implemented capabilities and returns an immutable description. `supportsOperation` tests a validated operation and rejects unknown operation names. `supportsReverse` is a type guard. Both assertion helpers return `void` on a valid plugin list and throw `UnsupportedReverseError` or `UnsupportedStreamingError` respectively if an operation is unsupported.

### Data conversion and manifests

```ts
function detectType(input: unknown): string;
function toBuffer(input: unknown): Buffer;
function assertOriginalType(value: unknown): asserts value is string;
function fromBuffer(buffer: Buffer, targetType: string, maxFrameBytes?: number): unknown;
function makeContext(
  requestId: string,
  extra?: Record<string, unknown>,
  logger?: Logger,
  span?: Span,
  signal?: AbortSignal,
  limits?: Readonly<EngineLimits>,
): ProcessorContext;
function buildManifest(plugins: readonly ProcessorPlugin[]): PipeXManifest;
function isManifest(value: unknown): value is PipeXManifest;
```

`detectType` classifies inputs (`buffer`, `array`, `object`, and primitive types); `toBuffer` converts a value to a Buffer, using MessagePack for non-null objects. `assertOriginalType` validates a supported decoding type and throws otherwise. `fromBuffer` decodes a Buffer according to a **trusted** target type, rejecting malformed serialized values, incorrect types, or frame limit violations. `makeContext` creates a request-scoped processing context with timestamp and provided integrations. `buildManifest` builds a versioned manifest containing plugin name/version identifiers; `isManifest` tests its structure, not its authenticity.

### Streaming constructors and adapters

```ts
function buildManifestHeaderTransform(manifest: PipeXManifest): Transform;
function buildManifestExtractTransform(onManifest: (manifest: PipeXManifest) => void): Transform;
class GuardedUnpackrStream extends UnpackrStream {
  constructor(options?: Record<string, unknown>, maxInputBytes?: number);
}
function createPackrStream(): PackrStream;
function createUnpackrStream(maxInputBytes?: number): GuardedUnpackrStream;
function buildByteLimitTransform(maxBytes: number, label: string): Transform;
function buildObjectLimitTransform(maxFrames: number): Transform;
function assertKnownValueByteLimit(value: unknown, maxBytes: number, label: string): void;
function buildKnownValueByteLimitTransform(maxBytes: number, label: string): Transform;
function buildFallbackTransform(
  plugin: ProcessorPlugin,
  reverse: boolean,
  emitProgress?: (bytes: number) => void,
  logger?: Logger,
  tracer?: Tracer,
  dlq?: Writable,
  streamContext?: StreamPluginContext,
): Transform;
function buildNdjsonTransform(): Transform;
function buildTransformChain(
  plugins: readonly ProcessorPlugin[],
  mode: 'compress' | 'decompress',
  reverse?: boolean,
  onProgress?: (bytes: number) => void,
  logger?: Logger,
  tracer?: Tracer,
  dlq?: Writable,
  streamContext?: StreamPluginContext,
): (Duplex | Transform | PackrStream | GuardedUnpackrStream)[];
function runPipeline(
  source: Readable,
  transforms: (Duplex | Transform | PackrStream | GuardedUnpackrStream)[],
  destination: Writable,
  options?: { signal?: AbortSignal },
): Promise<void>;
```

`buildManifestHeaderTransform` prepends a manifest to a byte stream; `buildManifestExtractTransform` removes and validates an initial manifest frame and invokes `onManifest`. `GuardedUnpackrStream` and `createUnpackrStream` apply an input-byte budget to MessagePack decoding; `createPackrStream` produces a serialization stream. The byte/object limit builders pass through accepted data and emit an error when totals exceed configured bounds. `assertKnownValueByteLimit` checks the byte length of supported, directly measurable values; it returns `void` or throws. `buildKnownValueByteLimitTransform` applies that check per stream value.

`buildFallbackTransform` executes a plugin **per chunk**, using the optional failure sink and telemetry hooks; it must not be used for transforms requiring complete-message semantics. `buildNdjsonTransform` serializes incoming objects as newline-delimited JSON. `buildTransformChain` creates the ordered chain, preferring native plugin streams and rejecting unsupported operations. `runPipeline` awaits Node.js pipeline completion, returning `Promise<void>` and rejecting source, transform, destination, or abort errors.

### MessagePack frame guards

```ts
function assertMessagePackFrameLimits(
  input: Buffer | Uint8Array,
  maxFrameBytes: number,
  maxFrames?: number,
): number;
function buildFrameLimitTransform(maxFrameBytes: number, maxFrames: number): Transform;
```

The assertion scans MessagePack without fully deserializing it, enforces frame length/count budgets, and returns the number of valid frames. It throws on malformed or oversized encodings. The transform performs equivalent incremental checks across stream chunks and emits errors on incomplete or invalid frames.

### Filesystem path helpers

```ts
function assertExists(inputPath: string, allowedRoot?: string): string;
function resolveOutputPath(outputPath: string, allowedRoot?: string): string;
```

`assertExists` returns the canonical path of an existing input beneath an allowed root and throws if missing or outside that root. `resolveOutputPath` returns a canonicalized candidate destination path after root/parent checks; it rejects unsafe paths and missing parents. **These path-only utilities are not a substitute for the native handle-based safety boundary of `engine.file`.**

### Exported constants and codecs

| Export | Type / value | Meaning |
| --- | --- | --- |
| `PIPEX_MANIFEST_KEY` | `'__pipex_v'` | Versioned manifest property |
| `PACKR` | `Packr` instance | Preconfigured MessagePack writer |
| `UNPACKR` | `Unpackr` instance | Preconfigured MessagePack reader |
| `MAX_FRAME_BYTES` | `256 * 1024 * 1024` | Deprecated legacy constant; use `DEFAULT_LIMITS.maxFrameBytes` |
| `DEFAULT_HIGH_WATER` | `64 * 1024` | High-water size constant |
| `DEFAULT_LIMITS` | `Readonly<EngineLimits>` | Frozen default operation and resource limits |
| `ORIGINAL_TYPES` | Frozen readonly string tuple | Supported original-type identifiers |

Codecs expose their underlying `msgpackr` methods and errors rather than the controller's checked operation contract. Prefer `binary.pack`/`binary.unpack` when enforcing PipeX bounds.

### KMS capability helpers

```ts
function getKmsProviderCapabilities(provider: KmsProvider): Readonly<KmsProviderCapabilities>;
function supportsKmsOperation(provider: KmsProvider, operation: KmsOperation): boolean;
```

The first returns validated provider capabilities. The second returns whether the specified operation is supported. Both reject invalid provider definitions; the second also rejects unknown operation names.

## Error classes and failure behavior

`PipeXError` exposes a typed `code: PipeXErrorCode`. Typed exports are:

- `UnsupportedReverseError`, `UnsupportedStreamingError`, `InvalidPluginCapabilityError`.
- `OperationAbortedError`, `OperationTimeoutError`.
- `KmsProviderError`, `KmsAuthenticationError`, `KmsProviderAuthenticationError`, `KmsProviderUnavailableError`, `UnsupportedKmsOperationError`, `InvalidKmsProviderCapabilityError`.
- `WorkerPoolClosedError`, `WorkerPoolCloseError`, `WorkerQueueFullError`, `WorkerTaskError`.

These classes reject unsupported operations, invalid capabilities, deadlines, cancelled requests, KMS authentication/provider faults, and worker lifecycle faults. Invalid input, malformed MessagePack, exceeded sizes, path rejection, compression errors, and HMAC mismatch may throw ordinary `Error` instances; not every failure is a `PipeXError`. Never log sensitive payload bytes or private keys when handling errors.

## Versioning and format compatibility

- The file/stream serialization-only manifest currently uses `__pipex_v: 1`.
- EncryptionPlugin 4 writes the versioned `PXAE` framed format. Its legacy v3 reader is enabled by default for migration and can be disabled with `allowLegacyDecrypt: false`.
- The worker stream transport uses `PXWK` v1 frames; incompatible historical unframed streams must be migrated by the old application.
- The KMS envelope uses the `PXKM` format with an explicit legacy migration option.
- Persisted transformed data requires the same logical plugin order, compatible formats, and the appropriate keys to reverse.

The `PXAE` header uses wire-format version 1, while the encryption plugin implementation is version 4.0.0. These are separate version values. The presence of a version number does not guarantee that every future release will support every historical format.

## Resource and security guidance

See [production operations](enterprise.md), [architecture](architecture.md), and [encryption migration](encryption-v4-migration.md). Prefer explicit operation limits and timeouts, native streams for large payloads, private filesystem roots, and external key storage. `piscina` and `koffi` are regular dependencies even though worker and native-file usage is opt-in at runtime.

## Typed errors

All public domain errors inherit from `PipeXError` (and `Error`). They expose `name`, `code`, `message`, optional `cause`, `transformName` and `stage`. The new fixed error messages never serialize payloads, keys or passphrases. Do not attach untrusted provider errors as causes or log input buffers.

| Class | Code | Meaning |
| --- | --- | --- |
| `ValidationError` | `VALIDATION_FAILED` | Invalid serialized input or schema validation |
| `CompressionError` | `COMPRESSION_FAILED` | Compression/decompression or size validation |
| `EncryptionError` | `ENCRYPTION_ERROR` | Invalid encryption configuration |
| `HashingError` | `HASHING_FAILED` | HMAC verification or hashing failure |
| `PipelineAbortedError` | `OPERATION_ABORTED` | Cancellation; existing `OperationAbortedError` inherits from it |
| `UnsupportedAlgorithmError` | `UNSUPPORTED_ALGORITHM` | Unsupported compression, encryption or hash algorithm |

Existing specialized errors remain part of the API: `OperationTimeoutError`, `UnsupportedReverseError`, `UnsupportedStreamingError`, `InvalidPluginCapabilityError`, KMS provider/authentication errors, and worker pool/task errors. Transport and operating-system failures may still surface as native errors; not every error path is normalized.

```ts
import { PipeXError, HashingError, PipelineAbortedError } from '@snyxex/pipex';
try {
  await engine.binary.run(input);
} catch (error: unknown) {
  if (error instanceof HashingError) console.error(error.code);
  else if (error instanceof PipelineAbortedError) console.error('Cancelled');
  else if (error instanceof PipeXError) console.error(error.code, error.stage);
  else throw error;
}
```
