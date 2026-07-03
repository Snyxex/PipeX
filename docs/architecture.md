# Architecture

PipeX is organized around a small core and three controllers.

## High-Level Flow

```text
DataEngine
  ├─ binary controller: values and buffers
  ├─ file controller: file streams
  ├─ stream controller: Node.js streams
  └─ plugin list: ordered ProcessorPlugin instances
```

## DataEngine Responsibilities

`DataEngine` owns cross-cutting behavior:

- Plugin registration.
- Global schema validation.
- Lifecycle events.
- Logger and tracer references.
- Dead letter queue stream.
- Audit logger.
- Schema registry.

Controllers call back into the engine for lifecycle events, progress, errors, validation, and plugin access.

## Controller Responsibilities

### Binary Controller

The binary controller converts input values into buffers, executes plugin `process()` methods in order, and returns an `EngineResult`.

During `undo()`, it executes plugin `reverse()` methods in reverse order and converts the final buffer back to the original or requested type.

### File Controller

The file controller creates read and write streams, builds a transform chain, and runs the pipeline with `node:stream/promises`.

It is intended for large data because it does not require the full file in memory.

### Stream Controller

The stream controller exposes lower-level primitives for existing Node.js stream workflows.

It supports:

- Full source-to-destination pipeline orchestration.
- Writable endpoints.
- Reverse writable endpoints.
- MsgPack pack and unpack transforms.

## Plugin Execution

Plugins implement:

```ts
process(data, ctx)
reverse?(data, ctx)
createStream?(mode)
```

For stream pipelines, PipeX uses `createStream()` if the plugin provides it. Otherwise, it wraps `process()` and `reverse()` in a fallback transform.

## Reverse Processing

A pipeline registered as:

```text
compression -> hashing -> encryption
```

is reversed as:

```text
decryption -> HMAC verification -> decompression
```

This behavior is central to reversible pipelines.

## Manifest System

PipeX manifests record the plugin chain.

```ts
interface PipeXManifest {
  __pipex_v: 1;
  plugins: string[];
  ts: number;
}
```

Manifest use cases:

- Inspect which pipeline produced a payload.
- Warn when current plugins do not match a payload.
- Carry metadata through binary or file transports.

## Serialization

PipeX uses `msgpackr` for object and array serialization.

Conversion rules:

| Input | Buffer conversion |
| --- | --- |
| `Buffer` | Used directly. |
| `ArrayBuffer` | Converted with `Buffer.from`. |
| object or array | MsgPack encoded. |
| number or boolean | String encoded. |
| string | UTF-8 encoded. |
| null or undefined | Empty or null representation depending on restoration target. |

## Error Handling

Controllers emit `error` and then rethrow. Stream fallback transforms can divert failed chunks to the configured DLQ.

Plugin retries are handled by `withRetry()` when `retryOptions` are present.

## Build Layout

The package build emits:

```text
dist/index.mjs
dist/index.d.mts
dist/worker_piscina.mjs
dist/worker_piscina.d.mts
```

`WorkerPoolPlugin` needs the worker artifact beside `dist/index.mjs`.
