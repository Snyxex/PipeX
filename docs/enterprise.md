# Enterprise Features

This guide covers operational, security, and reliability features.

## Audit Logging

Use `setAuditLogger()` to capture records for binary processing and reversing.

```ts
engine.setAuditLogger({
  async log(record) {
    await auditStore.write(record);
  },
});
```

Audit records include:

- `requestId`
- `operation`
- `pluginChain`
- `timestamp`
- `metadata`

Use this for compliance, investigation, and pipeline history.

## Structured Logging

Use `setLogger()` with any logger that supports `info`, `warn`, `error`, and `debug`.

```ts
engine.setLogger(logger);
```

Use this for request start/end logs, plugin retry logs, and pipeline errors.

## Tracing

Use `setTracer()` with an OpenTelemetry-style adapter.

```ts
engine.setTracer(tracer);
```

PipeX starts spans for binary runs and plugin execution. Spans can receive attributes and events.

## Schema Registry

Use `setSchemaRegistry()` and `loadSchema()` when schemas are managed outside the application.

```ts
engine.setSchemaRegistry({
  async getSchema(subject, version) {
    return fetchSchema(subject, version);
  },
});

await engine.loadSchema('user', 2);
```

Use this when multiple services must share schema versions.

## Dead Letter Queue

Use `setDlq()` with stream pipelines to preserve failed chunks.

```ts
engine.setDlq(deadLetterWritable);
await engine.stream.pipe(input, output);
```

If a plugin fails after retries and a DLQ is configured, PipeX writes the original chunk to the DLQ and drops it from the main stream.

Use this for streaming systems where one bad chunk should not stop the whole pipeline.

## Retry Policies

Plugins can define retry behavior.

```ts
class RemotePlugin extends BasePlugin {
  name = 'remote';
  version = '1.0.0';
  retryOptions = {
    attempts: 3,
    backoff: 'exponential' as const,
    delayMs: 100,
  };

  async process(data: Buffer) {
    return callRemoteTransform(data);
  }
}
```

Use retries for transient failures. Do not use them to hide deterministic data errors.

## Path Safety

File APIs accept `allowedRoot`.

```ts
await engine.file.process(inputPath, outputPath, '/var/app/uploads');
```

PipeX resolves the input path and rejects paths outside the allowed root.

Use this with user-controlled file paths.

## Envelope Encryption with KMS

`KmsEncryptionPlugin` implements envelope encryption:

1. Generate a data key through a KMS provider.
2. Encrypt payload locally with AES-256-GCM.
3. Store the encrypted data key in the payload header.
4. Decrypt the data key through KMS during reverse processing.

```ts
const engine = new DataEngine()
  .use(new Plugins.KmsEncryption({
    kms,
    keyId: 'alias/pipex',
  }));
```

Use this when encryption keys must be controlled by an external KMS.

## Production Pipeline Recommendations

- Compress before encryption.
- Hash before encryption if you want integrity metadata inside the encrypted envelope.
- Keep encryption keys outside source code.
- Use schema validation before expensive transformations.
- Use `allowedRoot` for user-provided file paths.
- Run `npm run typecheck`, `npm run build`, and `npm test` before publishing.
