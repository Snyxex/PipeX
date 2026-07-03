# Plugin Reference

Plugins transform buffers. For binary pipelines, PipeX converts values to buffers before calling plugins. For file and stream pipelines, plugins operate on stream chunks or plugin-provided transforms.

## Plugin Order

Forward processing uses registration order.

```ts
engine
  .use(new Plugins.Compression({ type: 'gzip' }))
  .use(new Plugins.Hashing({ algorithm: 'sha256', secret }))
  .use(new Plugins.Encryption({ algorithm: 'aes-256-gcm', key }));
```

Reverse processing uses the opposite order.

## CompressionPlugin

Compresses and decompresses data.

```ts
new Plugins.Compression({
  type: 'gzip',
  level: 6,
});
```

Options:

| Option | Values | Description |
| --- | --- | --- |
| `type` | `gzip`, `brotli`, `none` | Compression format. |
| `level` | number | Compression level. Defaults to `6` for gzip and `11` for Brotli. |

Use cases:

- Reduce file or payload size.
- Compress before encryption.
- Compare gzip and Brotli output sizes.

## EncryptionPlugin

Encrypts and decrypts data with authenticated encryption.

```ts
new Plugins.Encryption({
  algorithm: 'aes-256-gcm',
  key: randomBytes(32),
});
```

Options:

| Option | Values | Description |
| --- | --- | --- |
| `algorithm` | `aes-256-gcm`, `chacha20-poly1305` | Encryption algorithm. |
| `key` | `Buffer` | 32-byte key. |

Use cases:

- Protect data at rest.
- Protect files before storage.
- Encrypt stream output.

## HashingPlugin

Adds and verifies an HMAC.

```ts
new Plugins.Hashing({
  algorithm: 'sha256',
  secret: 'at-least-16-characters',
});
```

Options:

| Option | Values | Description |
| --- | --- | --- |
| `algorithm` | `sha256`, `sha512` | HMAC digest algorithm. |
| `secret` | string | Secret used for HMAC. Must be at least 16 characters. |

Use cases:

- Tamper detection.
- Integrity verification before decompression.
- Detect accidental or malicious payload changes.

## ValidationPlugin

Validates MsgPack-decoded structured data with Zod.

```ts
new Plugins.Validation({
  schema,
  validateOnReverse: true,
});
```

Options:

| Option | Values | Description |
| --- | --- | --- |
| `schema` | `z.ZodType` | Schema used for validation. |
| `validateOnReverse` | boolean | Also validate during reverse processing. |

Use cases:

- Reusable validation as part of a pipeline.
- Defensive validation after restore.

## BenchmarkPlugin

Records basic byte and timing metadata while leaving data unchanged.

```ts
new Plugins.Benchmark();
```

Use cases:

- Measure step timings.
- Include a transparent plugin in a pipeline for metrics.
- Compare transformation costs.

## WorkerPoolPlugin

Runs CPU work in a Piscina worker pool.

```ts
new Plugins.WorkerPool({
  maxThreads: 2,
});
```

Options:

| Option | Values | Description |
| --- | --- | --- |
| `maxThreads` | number | Maximum worker threads used by Piscina. |

Use cases:

- CPU-bound transformations.
- Worker-backed custom processing.
- Keeping the event loop responsive.

The built-in worker demonstrates XOR processing. For production domain work, replace or extend the worker implementation.

## KmsEncryptionPlugin

`KmsEncryptionPlugin` implements envelope encryption through a `KmsProvider`.

```ts
import { KmsEncryptionPlugin } from 'pipex';

new KmsEncryptionPlugin({
  kms,
  keyId: 'alias/pipex',
});
```

Options:

| Option | Description |
| --- | --- |
| `kms` | Provider with `generateDataKey`, `encrypt`, and `decrypt`. |
| `keyId` | KMS key identifier. |

Use cases:

- Enterprise envelope encryption.
- External key management.
- Rotating data keys while keeping payload encryption local.

It is also available as `Plugins.KmsEncryption`.

## Custom Plugins

Implement `ProcessorPlugin` or extend `BasePlugin`.

```ts
class RedactionPlugin extends BasePlugin {
  name = 'redaction';
  version = '1.0.0';

  process(data: Buffer) {
    return Buffer.from(data.toString().replaceAll('secret', '[redacted]'));
  }
}
```

Use custom plugins when the transformation is specific to your domain.
