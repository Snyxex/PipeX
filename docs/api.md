# API Reference

## Imports

```ts
import {
  DataEngine,
  Plugins,
  BasePlugin,
  type ProcessorPlugin,
  type ProcessorContext,
  type EngineResult,
} from 'pipex';
```

## DataEngine

`DataEngine` owns the pipeline and exposes three controllers.

```ts
const engine = new DataEngine();
engine.use(plugin);
```

### Methods

| Method | Description |
| --- | --- |
| `use(plugin)` | Registers a plugin and returns the engine. |
| `setSchema(schema)` | Sets a global Zod schema for validation. |
| `validate(data)` | Validates data against the global schema, if one is configured. |
| `setLogger(logger)` | Adds structured logging. |
| `setTracer(tracer)` | Adds tracing spans. |
| `setDlq(writable)` | Adds a dead letter queue for stream fallback failures. |
| `setAuditLogger(logger)` | Adds audit logging. |
| `setSchemaRegistry(registry)` | Adds a schema registry provider. |
| `loadSchema(subject, version?)` | Loads and sets a schema from the registry. |
| `startRequest(metadata?)` | Creates a request ID and emits `start`. Mostly used by controllers. |
| `endRequest(requestId, durationMs?)` | Emits `end`. Mostly used by controllers. |

### Static Methods

| Method | Description |
| --- | --- |
| `DataEngine.registerPlugin(name, pluginClass)` | Registers a plugin class for config-based bootstrap. |
| `DataEngine.fromConfig(config)` | Creates an engine from an `EngineConfig`. |

## Binary Controller

Use `engine.binary` for values and buffers that fit in memory.

### `binary.run(input)`

Runs the plugin pipeline and returns an `EngineResult`.

```ts
const result = await engine.binary.run({ id: 1 });
```

### `binary.undo(result)`

Reverses a previous `EngineResult`.

```ts
const restored = await engine.binary.undo<{ id: number }>(result);
```

### `binary.undo(buffer, forceType)`

Reverses a raw buffer and converts it to the requested type.

```ts
const restored = await engine.binary.undo<string>(result.data, 'string');
```

Common `forceType` values are `string`, `buffer`, `object`, `array`, `number`, `boolean`, `null`, and `json`.

### `binary.pack(data)`

Serializes a value with MsgPack.

```ts
const packed = engine.binary.pack(data);
```

### `binary.unpack(input)`

Deserializes a MsgPack buffer.

```ts
const data = engine.binary.unpack<MyType>(packed);
```

### `binary.packWithManifest(data)`

Serializes a manifest frame followed by a data frame.

```ts
const packed = engine.binary.packWithManifest(data);
```

### `binary.unpackWithManifest(input)`

Reads a manifest-prefixed buffer.

```ts
const { manifest, data } = engine.binary.unpackWithManifest<MyType>(packed);
```

## File Controller

Use `engine.file` for file-to-file streaming.

### `file.process(inputPath, outputPath, allowedRoot?)`

Runs the forward plugin pipeline from input file to output file.

```ts
await engine.file.process('input.txt', 'output.pipex');
```

If `allowedRoot` is provided, the input path must resolve inside that root.

### `file.reverse(inputPath, outputPath, allowedRoot?)`

Runs the reverse plugin pipeline from input file to output file.

```ts
await engine.file.reverse('output.pipex', 'restored.txt');
```

### `file.pack(inputPath, outputPath, allowedRoot?)`

Writes MsgPack data with a manifest header.

```ts
await engine.file.pack('input.json', 'input.msgpack');
```

### `file.unpack(inputPath, outputPath, allowedRoot?)`

Reads MsgPack data, extracts the manifest, emits `manifest`, and writes NDJSON.

```ts
await engine.file.unpack('input.msgpack', 'input.ndjson');
```

## Stream Controller

Use `engine.stream` for Node.js stream integration.

### `stream.pipe(source, destination, reverse?)`

Runs a `Readable` through the plugin chain into a `Writable`.

```ts
await engine.stream.pipe(source, destination);
await engine.stream.pipe(source, destination, true);
```

### `stream.into(destination)`

Returns a writable endpoint for forward processing.

```ts
source.pipe(engine.stream.into(destination));
```

### `stream.reverseInto(destination)`

Returns a writable endpoint for reverse processing.

```ts
source.pipe(engine.stream.reverseInto(destination));
```

### `stream.pack()`

Returns a transform for object-to-MsgPack stream packing with a manifest header.

```ts
objectSource.pipe(engine.stream.pack()).pipe(byteDestination);
```

### `stream.unpack()`

Returns a transform for MsgPack bytes to objects. Emits `manifest` on the engine.

```ts
byteSource.pipe(engine.stream.unpack()).on('data', console.log);
```

## Events

```ts
engine.on('start', (requestId) => {});
engine.on('plugin:after', (name, durationMs) => {});
engine.on('progress', (bytes, requestId) => {});
engine.on('error', (error, requestId) => {});
engine.on('end', (requestId, durationMs) => {});
engine.on('manifest', (manifest, requestId) => {});
```

## EngineResult

```ts
interface EngineResult {
  data: Buffer;
  originalType: string;
  pipeline: string[];
  metrics: {
    durationMs: number;
    steps: Record<string, number>;
  };
}
```

## ProcessorPlugin

```ts
interface ProcessorPlugin {
  readonly name: string;
  readonly version: string;
  process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): Transform;
  retryOptions?: RetryOptions;
}
```
