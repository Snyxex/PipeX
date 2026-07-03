# PipeX Documentation

PipeX is a pipeline engine. You create a `DataEngine`, register plugins in the order data should be transformed, then choose the controller that matches the data shape: binary values, files, or streams.

## Start Here

- [Use Cases](./use-cases.md): task-oriented examples for every supported workflow.
- [API Reference](./api.md): controller methods, engine configuration, events, and result types.
- [Plugin Reference](./plugins.md): built-in plugins and their options.
- [Architecture](./architecture.md): how the engine, controllers, manifests, and plugins fit together.
- [Enterprise Features](./enterprise.md): audit logging, KMS-style encryption, schema registries, retries, DLQ, logging, and tracing.

## Core Concepts

- **Engine**: `DataEngine` owns the plugin list, schema, logger, tracer, audit logger, DLQ, and lifecycle events.
- **Plugin**: a transformation with `process()` and optional `reverse()` methods.
- **Controller**: an API surface optimized for a specific input shape.
- **Manifest**: metadata that records the plugin chain as `name@version`.
- **Pipeline**: plugins execute in registration order when processing and in reverse order when undoing.

## Minimal Example

```ts
import { DataEngine, Plugins } from 'pipex';

const engine = new DataEngine()
  .use(new Plugins.Compression({ type: 'gzip' }));

const result = await engine.binary.run('hello');
const restored = await engine.binary.undo<string>(result);
```
