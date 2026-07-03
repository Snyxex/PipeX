// Export the Core
export * from './core/core.js';
export { DataEngine }        from './core/dataEngine.js';
export type {
  ProcessorPlugin,
  ProcessorContext,
  EngineResult,
  PipeXManifest,
  EngineEvents,
}                            from './core/types.js';
export { isManifest }        from './core/types.js';

export { BasePlugin } from './core/plugin.js';

// --- Standard Plugin Library ---
import { HashingPlugin } from './plugin/hashing.js';
import { EncryptionPlugin } from './plugin/encryption.js';
import { CompressionPlugin } from './plugin/compression.js';
import { BenchmarkPlugin } from './plugin/performance.js';
import { WorkerPoolPlugin } from './plugin/worker.js';
import { ValidationPlugin } from './core/validation.js';

export const Plugins = {
  Hashing: HashingPlugin,
  Encryption: EncryptionPlugin,
  Compression: CompressionPlugin,
  Benchmark: BenchmarkPlugin,
  WorkerPool: WorkerPoolPlugin,
  Validation: ValidationPlugin,
} as const;

// Also export individually for those who prefer it
export { HashingPlugin, EncryptionPlugin, CompressionPlugin, BenchmarkPlugin, WorkerPoolPlugin, ValidationPlugin };
