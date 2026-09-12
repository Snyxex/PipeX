// Export the Core
export * from './core/core.js';
import { DataEngine } from './core/dataEngine.js';
export { DataEngine };
export type { PluginConstructor } from './core/dataEngine.js';
export type {
  ProcessorPlugin,
  ProcessorContext,
  EngineResult,
  PipeXManifest,
  EngineEvents,
  EngineLimits,
  OperationOptions,
  StreamPluginContext,
  RetryOptions,
  Logger,
  Span,
  Tracer,
  AuditRecord,
  AuditLogger,
  KmsProvider,
  KmsRequestOptions,
  SchemaRegistry,
  EngineConfig,
}                            from './core/types.js';
export { isManifest }        from './core/types.js';

export { BasePlugin } from './core/plugin.js';
export {
  KmsProviderError,
  OperationAbortedError,
  OperationTimeoutError,
  PipeXError,
  UnsupportedReverseError,
  UnsupportedStreamingError,
} from './core/errors.js';
export type { PipeXErrorCode } from './core/errors.js';

// --- Standard Plugin Library ---
import { HashingPlugin } from './plugin/hashing.js';
import { EncryptionPlugin } from './plugin/encryption.js';
import { CompressionPlugin } from './plugin/compression.js';
import { BenchmarkPlugin } from './plugin/performance.js';
import { WorkerPoolPlugin } from './plugin/worker.js';
import { ValidationPlugin } from './core/validation.js';
import { KmsEncryptionPlugin } from './plugin/kms_encryption.js';

export type { HashingOptions, HashAlgorithm } from './plugin/hashing.js';
export type { EncryptionOptions, EncryptionAlgorithm } from './plugin/encryption.js';
export type { CompressionOptions, CompressionType } from './plugin/compression.js';
export type { WorkerPoolOptions } from './plugin/worker.js';
export type { ValidationOptions } from './core/validation.js';
export type { KmsEncryptionOptions } from './plugin/kms_encryption.js';

export const Plugins = {
  Hashing: HashingPlugin,
  Encryption: EncryptionPlugin,
  Compression: CompressionPlugin,
  Benchmark: BenchmarkPlugin,
  WorkerPool: WorkerPoolPlugin,
  Validation: ValidationPlugin,
  KmsEncryption: KmsEncryptionPlugin,
} as const;

// Make config-driven setup work out of the box while keeping custom plugin
// registration available through DataEngine.registerPlugin().
DataEngine.registerPlugin('hashing', HashingPlugin);
DataEngine.registerPlugin('encryption', EncryptionPlugin);
DataEngine.registerPlugin('compression', CompressionPlugin);
DataEngine.registerPlugin('benchmark', BenchmarkPlugin);
DataEngine.registerPlugin('worker-pool', WorkerPoolPlugin);
DataEngine.registerPlugin('validation', ValidationPlugin);
DataEngine.registerPlugin('kms-encryption', KmsEncryptionPlugin);

// Also export individually for those who prefer it
export { HashingPlugin, EncryptionPlugin, CompressionPlugin, BenchmarkPlugin, WorkerPoolPlugin, ValidationPlugin, KmsEncryptionPlugin };
