# Production operations

## Resource limits

Every engine has conservative defaults. Tune them for the workload instead of disabling them:

```ts
const engine = new DataEngine({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  maxFrameBytes: 8 * 1024 * 1024,
  maxFrames: 100_000,
  maxConcurrentOperations: 32,
  operationTimeoutMs: 60_000,
  maxRetryAttempts: 3,
  maxRetryDelayMs: 5_000,
});
```

The same values can be passed as `limits` to `DataEngine.fromConfig()`. That factory also wires supplied `logger`, `tracer`, `auditLogger`, `dlq`, `schema`, and `schemaRegistry` instances; it does not construct integrations from names or file paths.

Callers can supply `{ signal, timeoutMs }` to binary, file, and stream operations. A timeout of `0` disables only the per-operation deadline; input and output limits remain active.

## Logging and events

```ts
engine.setLogger({
  info: (message, context) => logger.info(context, message),
  warn: (message, context) => logger.warn(context, message),
  error: (message, context) => logger.error(context, message),
  debug: (message, context) => logger.debug(context, message),
});

engine.on('progress', (bytes, requestId) => metrics.bytes.add(bytes, { requestId }));
engine.on('error', (error, requestId) => logger.error({ requestId, error }, 'PipeX operation failed'));
```

Logger and event-listener exceptions are isolated from transformation work. Audit logging is awaited and may fail the caller after transformation completion; operate the audit sink accordingly.

## Retries and dead-letter output

```ts
class RemotePlugin extends BasePlugin {
  readonly name = 'remote';
  readonly version = '1.0.0';
  retryOptions = { attempts: 3, backoff: 'exponential' as const, delayMs: 100 };
  // process() implementation
}

engine.setDlq(createWriteStream('./var/pipex.dlq', { flags: 'a', mode: 0o600 }));
```

Retries are capped by engine limits and honor cancellation. The dead-letter stream receives failed chunks only after retry exhaustion. Protect and monitor it like any other potentially sensitive data sink.

## Encryption and key management

Use a unique 32-byte key for AES-256-GCM or ChaCha20-Poly1305 and obtain it from a secret manager. Never embed production keys in configuration files or source code.

```ts
import { DataEngine, KmsEncryptionPlugin, type KmsProvider } from 'pipex';

const kms: KmsProvider = createKmsProvider();
const engine = new DataEngine().use(new KmsEncryptionPlugin({
  kms,
  keyId: 'production/data-pipeline',
}));
```

The KMS plugin is binary-only. Use `binary.run()` and `binary.undo()` or provide an application-level framed transport for large streams.

## Audit logging

```ts
engine.setAuditLogger({
  async log(record) {
    await auditStore.append(record);
  },
});
```

Audit records include request ID, operation, plugin chain, timestamp, and operation metadata. They do not contain payload bytes.

Binary, file, and stream controllers emit the same audit record shape. Awaitable APIs propagate audit-sink failures to the caller. Adapter APIs that return a stream (`into`, `reverseInto`, `pack`, and `unpack`) report asynchronous audit failures through the engine's `error` event because their data stream may already be complete.

## Deployment checklist

- Use `npm ci` with the committed lockfile.
- Run `npm test`, `npm run build`, and `npm pack --dry-run` in CI.
- Store encryption and HMAC secrets outside the package and application image.
- Configure explicit resource limits and deadlines for the workload.
- Keep output roots private and owned by the service account.
- Monitor error events, dead-letter growth, timeouts, and worker-pool saturation.
- Exercise round-trip and tamper tests with production-equivalent KMS, storage, and filesystem permissions before rollout.
