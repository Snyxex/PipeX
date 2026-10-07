# Production operations

## Resource limits

Every engine has conservative defaults. Tune them for the workload instead of disabling them:

```ts
const engine = new DataEngine({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxFrameBytes: 8 * 1024 * 1024,
  maxFrames: 100_000,
  maxConcurrentOperations: 32,
  operationTimeoutMs: 5 * 60_000,
  maxRetryAttempts: 5,
  maxRetryDelayMs: 30_000,
  maxKmsEncryptedKeyBytes: 64 * 1024,
  maxKmsKeyIdBytes: 512,
});
```

The same values can be passed as `limits` to `DataEngine.fromConfig()`. That factory also wires supplied `logger`, `tracer`, `auditLogger`, `dlq`, `schema`, and `schemaRegistry` instances; it does not construct integrations from names or file paths.

All defaults are finite. `maxFrameBytes` applies to each top-level MessagePack
value, while `maxFrames` counts application values (the PipeX manifest is not an
application value). Incoming frame structure and declared string, binary, array,
map, and extension lengths are checked before decoding. PipeX's bounded wire
writers preserve Set, Error and RegExp using msgpackr moreTypes. The bounded
format includes their extension prefixes and their subsequent
value in the same logical frame. It permits payload-contained undefined, BigInt,
typed-array and timestamp extensions. C1, records, bundled strings, structured
references and unknown extensions are rejected; PipeX's encoders disable records,
bundles and structured cloning. Custom msgpackr extension registration is outside
this wire profile.

Native and buffer-based standard plugins receive the same immutable request
limits. Their temporary buffers and predictable output sizes are checked before
copying, cryptographic work, validation parsing, or worker transfer;
decompression uses the configured output bound. KMS encryption rejects outputs
that cannot fit even the smallest valid envelope before contacting the provider,
then rechecks the provider-supplied envelope size. The encrypted KMS data-key
field is bounded by the central `maxKmsEncryptedKeyBytes` limit (64 KiB by
default). Provider key identifiers are independently bounded as UTF-8 by
`maxKmsKeyIdBytes` (512 bytes by default).

`engine.limits` is frozen. Use `setLimits()` between operations; changing limits
while a request is active is rejected so a pipeline cannot observe mixed limits.

Callers can supply `{ signal, timeoutMs }` to binary, file, and stream operations. A timeout of `0` disables only the per-operation deadline; input and output limits remain active.

Deadlines stop waiting for plugin promises, including plugins that ignore their
signal. Non-cooperative work still occupies concurrency capacity until its
promise settles. Late results are discarded. This prevents repeated timeouts
from starting unbounded background tasks; use workers for terminable CPU work.
Synchronous work cannot be preempted, but cannot report success after its deadline.

## File-system boundary

Keep the allowed root, its configuration, and input/output directories private
and controlled by the service account. Path containment is a directory-entry
boundary, not a sandbox against application code, the same OS identity,
administrators, mount-namespace changes, or modification of file contents by
principals already authorized to write them.

File sessions bind directories and input/output objects before plugin callbacks:

- Windows opens the root with CreateFileW, verifies its final handle path, and
  opens each child relative to a directory handle with NtCreateFile and
  FILE_OPEN_REPARSE_POINT. Reparse points and non-disk/non-regular files are
  rejected. Directory handles exclude delete sharing; input and temporary
  output handles also exclude write sharing. The temporary output is renamed
  relative to the pinned destination directory with NtSetInformationFile, and
  failure cleanup deletes that exact opened object by handle.
- POSIX opens directory components with O_DIRECTORY/O_NOFOLLOW and opens files
  using openat. A mode-0700 temporary directory with verified ownership and
  permissions protects its mode-0600 output file. renameat and unlinkat operate
  relative to the acquired directory descriptors. Renaming a directory after
  admission does not redirect work through a replacement symlink; the session
  continues using the original directory capability.

Native reads/writes run asynchronously with backpressure. Disposal waits for
pending native I/O before closing handles, including error/cancellation paths.
Native-binding or filesystem failures reject the file operation; there is no
fallback to a path-only open. Binary and stream APIs do not load native bindings.
Koffi 3.3.2 is pinned and its platform package must be included in installation.

The implementation follows the documented [NtCreateFile RootDirectory contract](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile),
[Windows rename information](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info),
and [POSIX directory-relative opens](https://man7.org/linux/man-pages/man2/openat.2.html).

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

## Retries and caller-provided failure sink

```ts
class RemotePlugin extends BasePlugin {
  readonly name = 'remote';
  readonly version = '1.0.0';
  retryOptions = { attempts: 3, backoff: 'exponential' as const, delayMs: 100 };
  // process() implementation
}

engine.setDlq(createWriteStream('./var/pipex.dlq', { flags: 'a', mode: 0o600 }));
```

Retries are capped by engine limits and honor cancellation. `dlq` and
`setDlq()` are retained compatibility names for an optional failure sink; the
value is always a `Writable` created and owned by the caller. PipeX does not
create storage, serialize records, end the stream, retain failed chunks for
later delivery, replay failures, manage jobs, or schedule delivery attempts.

For chunk-independent fallback transforms, PipeX writes the original failed
chunk once after plugin retries are exhausted and then rejects the operation
with the plugin error. A `false` result from `write()` pauses completion until
`drain`. Sink errors and premature closure fail the operation, and cancellation
removes the temporary `drain`, `error`, and abort listeners. Native plugin
streams manage their own failure semantics and do not use this fallback hook.

The sink receives raw input bytes, not a redacted error envelope. Those bytes
may contain plaintext, credentials, personal data, or other secrets. The caller
is responsible for access control, encryption, retention, redaction, monitoring,
stream lifecycle, and any persistence or replay policy. Structured failure
context remains available separately through PipeX logging and error handling;
PipeX never logs the failed chunk itself.

`failureSink` may be considered later as a clearer additive alias. No rename or
removal of `dlq`/`setDlq()` is made in the Standard Core.

## Local worker pools

`WorkerPoolPlugin` runs only caller-owned module exports in local Piscina worker
threads. It is not a scheduler or durable job system. No demo encryption or
built-in XOR transform is exported by the package.

```ts
const workers = new WorkerPoolPlugin({
  filename: new URL('./worker.mjs', import.meta.url),
  processName: 'transform',
  reverseName: 'restore',
  maxThreads: 4,
  maxQueue: 64,
  taskTimeoutMs: 30_000,
  closeTimeoutMs: 10_000,
});
```

The default worker count is the smaller of four and the host's available CPU
parallelism; workers are created lazily. The default queue holds 64 waiting
tasks. The implementation caps configuration at 128 workers and 100,000 queued
tasks. Admission is rejected before copying or transferring input once all
worker and queue slots are occupied. The rejection is a typed
`WorkerQueueFullError` with code `WORKER_QUEUE_FULL`; callers should apply
upstream backpressure or retry outside the pool.

Each task combines its caller `AbortSignal` with `taskTimeoutMs`. When
`taskTimeoutMs` is omitted, the central `operationTimeoutMs` applies; an
explicit zero disables only the plugin-level timer. Cancellation and timeout
reject as `OperationAbortedError` and `OperationTimeoutError`. Worker handler
errors and unexpected worker exits reject as `WorkerTaskError`, so submitted
promises do not remain pending.

`close()` atomically stops admission, drains every accepted running or queued
task, and is bounded by `closeTimeoutMs`. Concurrent calls await the same
shutdown. `close({ force: true })` terminates running and queued work immediately;
those task promises reject as `WorkerTaskError`. A graceful-close timeout rejects
as `WorkerPoolCloseError` after terminating the pool. New work rejects as
`WorkerPoolClosedError` as soon as shutdown begins.

### Worker stream format migration

WorkerPoolPlugin 5 writes PXWK v1 streams: a five-byte magic/version header,
length-prefixed transformed task records, and an explicit end marker. Each
reverse task receives exactly one forward task result, independent of transport
chunk boundaries. Frame size/count and aggregate byte limits apply. The format
provides framing, not authentication; use an outer encryption or HMAC plugin
when required.

Binary worker processing retains the caller's raw transform format. Worker
streams from 4.x had no recoverable task boundaries and are rejected by 5.x.
Before upgrading, decode existing streams with the old application and its
original chunk-boundary contract, then re-encode them. Do not guess boundaries
or silently reinterpret raw bytes as framed records.

## Encryption and key management

`KmsEncryptionPlugin` 2.1 adds provider capability discovery, sanitized error
classification, and provider-call deadlines without changing the `PXKM` v1
ciphertext format introduced by plugin version 2.0.

Use a unique 32-byte key for AES-256-GCM or ChaCha20-Poly1305 and obtain it from a secret manager. Never embed production keys in configuration files or source code.

```ts
import {
  DataEngine,
  KmsEncryptionPlugin,
  KmsProviderAuthenticationError,
  KmsProviderUnavailableError,
  getKmsProviderCapabilities,
  type KmsProvider,
} from 'pipex';

const kms: KmsProvider = createKmsProvider();
console.log(getKmsProviderCapabilities(kms));
// { encrypt: false, decrypt: true, generateDataKey: true }

const engine = new DataEngine().use(new KmsEncryptionPlugin({
  kms,
  keyId: 'production/data-pipeline',
}));
```

The KMS plugin is binary-only. Use `binary.run()` and `binary.undo()` or provide an application-level framed transport for large streams.

Provider methods receive a request-local `AbortSignal`. The engine operation
deadline applies to every provider call; direct plugin calls use the same
central `operationTimeoutMs` default. A provider that cannot physically cancel
an in-flight SDK request may finish in the background, but PipeX stops waiting
at the deadline and clears any plaintext data key returned later.

Provider methods are optional. Declare a compatibility stub as unsupported so
PipeX never calls it:

```ts
const provider: KmsProvider = {
  capabilities: { encrypt: false, decrypt: true, generateDataKey: true },
  async encrypt() { throw new Error('legacy stub'); }, // never called by PipeX
  async decrypt(envelope, keyId, { signal } = {}) { /* adapter */ },
  async generateDataKey(keyId, { signal } = {}) { /* adapter */ },
};
```

Omitted capability flags are derived from method presence. A capability marked
`true` without an implementation is rejected. `KmsEncryptionPlugin` requires
`generateDataKey`; a provider without `decrypt` remains usable for forward-only
encryption and the plugin advertises `reverse: false`.

Provider adapters should translate credential rejection to
`KmsProviderAuthenticationError` and transient service/network unavailability
to `KmsProviderUnavailableError`. PipeX preserves those classifications as
sanitized errors. Unknown provider exceptions become `KmsProviderError`.
Provider exception messages, key IDs, envelopes, tokens, and payloads are not
copied into PipeX error messages or log contexts.

## Audit logging

```ts
engine.setAuditLogger({
  async log(record) {
    await auditStore.append(record);
  },
});
```

Audit records include request ID, operation, plugin chain, timestamp, and operation metadata. They do not contain payload bytes.

Binary, file, and stream controllers emit the same audit record shape. Awaitable APIs propagate audit-sink failures to the caller. The writable adapters `into` and `reverseInto` delay `finish` and propagate audit failures to the calling stream pipeline. The duplex serialization adapters `pack` and `unpack` report late audit failures through the engine's `error` event because their readable side may already be complete.

## Deployment checklist

- Use `npm ci` with the committed lockfile.
- Run `npm test`, `npm run build`, and `npm pack --dry-run` in CI.
- Store encryption and HMAC secrets outside the package and application image.
- Configure explicit resource limits and deadlines for the workload.
- Keep output roots private and owned by the service account.
- Monitor error events, dead-letter growth, timeouts, and worker-pool saturation.
- Exercise round-trip and tamper tests with production-equivalent KMS, storage, and filesystem permissions before rollout.
