# PipeX Enterprise Guide

This guide describes how to use the enterprise-grade features of PipeX to build robust, secure, and observable data pipelines.

## 📊 Observability

Enterprise applications must be observable. PipeX provides built-in hooks for structured logging and distributed tracing.

### Structured Logging
PipeX can be integrated with loggers like **Pino** or **Winston**.

```typescript
import pino from 'pino';
const logger = pino();

engine.setLogger({
  info:  (msg, ctx) => logger.info(ctx, msg),
  warn:  (msg, ctx) => logger.warn(ctx, msg),
  error: (msg, ctx) => logger.error(ctx, msg),
  debug: (msg, ctx) => logger.debug(ctx, msg),
});
```

### Distributed Tracing
PipeX is compatible with **OpenTelemetry**. You can inject a tracer to track plugin execution time and pipeline latency.

```typescript
engine.setTracer(myOtelTracer);
```

---

## 🛡️ Resilience

Transient failures are inevitable in distributed systems. PipeX handles them with automatic retries and Dead Letter Queues (DLQ).

### Automatic Retries
Plugins can specify retry policies.

```typescript
const plugin = new MyPlugin();
plugin.retryOptions = {
  attempts: 3,
  backoff: 'exponential',
  delayMs: 1000
};
```

### Dead Letter Queue (DLQ)
When a plugin fails after all retries, the original data chunk can be diverted to a DLQ instead of crashing the pipeline.

```typescript
import { createWriteStream } from 'node:fs';
engine.setDlq(createWriteStream('errors.log'));
```

---

## 🔐 Security & Compliance

### KMS Encryption
PipeX supports **Envelope Encryption** via external Key Management Services (KMS).

```typescript
import { KmsEncryptionPlugin } from 'pipex/plugins/kms';

engine.use(new KmsEncryptionPlugin({
  kms: new MyKmsProvider(), // Implements KmsProvider
  keyId: 'arn:aws:kms:us-east-1:123456789012:key/...'
}));
```

### Audit Logging
Every `run`, `undo`, `pack`, and `unpack` operation can be audited.

```typescript
engine.setAuditLogger({
  log: async (record) => {
    // Save to a secure audit database
    await db.audit.insert(record);
  }
});
```

---

## 🚀 Performance

### Warm Worker Pools
For heavy CPU tasks, use the `WorkerPoolPlugin` which utilizes a persistent pool of warm workers via `piscina`.

```typescript
import { WorkerPoolPlugin } from 'pipex/plugins/worker';
engine.use(new WorkerPoolPlugin({ maxThreads: 4 }));
```

---

## ⚙️ DevOps & Configuration

### Environment-Driven Setup
Bootstrap your engine from a JSON or YAML configuration file.

```typescript
const config = await readConfig('pipex.prod.json');
const engine = await DataEngine.fromConfig(config);
```

### Schema Registry
Ensure data consistency by fetching Zod schemas from a central registry.

```typescript
engine.setSchemaRegistry(myRegistry);
await engine.loadSchema('transactions/v1');
```
