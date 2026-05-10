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
export { HashingPlugin } from './plugin/hashing.js';
export { EncryptionPlugin } from './plugin/encryption.js';
export { CompressionPlugin } from './plugin/compression.js';
export { BenchmarkPlugin } from './plugin/performance.js';
export { WorkerPoolPlugin } from './plugin/worker.js';