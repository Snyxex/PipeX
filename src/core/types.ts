import type { Duplex, Writable } from 'node:stream';
import { z } from 'zod';

// ─── Observability Types ──────────────────────────────────────────────────────

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface Span {
  setAttribute(key: string, value: unknown): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, context?: ProcessorContext): Span;
}

// ─── Resilience Types ─────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts: number;
  backoff: 'exponential' | 'fixed';
  delayMs: number;
}

export interface EngineLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxFrameBytes: number;
  maxFrames: number;
  maxConcurrentOperations: number;
  operationTimeoutMs: number;
  maxRetryAttempts: number;
  maxRetryDelayMs: number;
  /** Maximum provider-wrapped data-key bytes accepted in a KMS envelope. */
  maxKmsEncryptedKeyBytes: number;
  /** Maximum UTF-8 bytes accepted for a provider key identifier. */
  maxKmsKeyIdBytes: number;
}

export interface OperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StreamPluginContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly limits: Readonly<EngineLimits>;
  readonly logger?: Logger;
  readonly tracer?: Tracer;
}

// ─── Security & Audit Types ───────────────────────────────────────────────────

export interface AuditRecord {
  requestId: string;
  operation: 'pack' | 'unpack' | 'process' | 'reverse';
  pluginChain: string[];
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface AuditLogger {
  log(record: AuditRecord): void | Promise<void>;
}

export type KmsOperation = 'encrypt' | 'decrypt' | 'generateDataKey';

export interface KmsProviderCapabilities {
  readonly encrypt: boolean;
  readonly decrypt: boolean;
  readonly generateDataKey: boolean;
}

export interface KmsProvider {
  /** Explicit false disables an operation even when a compatibility stub exists. */
  readonly capabilities?: Partial<KmsProviderCapabilities>;
  encrypt?(data: Buffer, keyId: string, options?: KmsRequestOptions): Promise<Buffer>;
  decrypt?(data: Buffer, keyId: string, options?: KmsRequestOptions): Promise<Buffer>;
  generateDataKey?(keyId: string, options?: KmsRequestOptions): Promise<{ plaintext: Buffer; ciphertext: Buffer }>;
}

export interface KmsRequestOptions {
  signal?: AbortSignal;
}

export interface SchemaRegistry {
  getSchema(subject: string, version?: number): Promise<z.ZodType<any>>;
}

export interface EngineConfig {
  plugins?: { name: string; options?: unknown }[];
  limits?: Partial<EngineLimits>;
  logger?: Logger;
  tracer?: Tracer;
  auditLogger?: AuditLogger;
  /** Optional caller-owned failure sink; `dlq` is retained for compatibility. */
  dlq?: Writable;
  schema?: z.ZodType<any>;
  schemaRegistry?: SchemaRegistry;
}

// ─── Core types ───────────────────────────────────────────────────────────────

export interface ProcessorContext {
  readonly requestId: string;
  readonly timestamp: number;
  readonly signal?: AbortSignal;
  readonly limits?: Readonly<EngineLimits>;
  metadata: Record<string, unknown>;
  logger?:  Logger;
  span?:    Span;
}

export interface ProcessorPlugin {
  readonly name:    string;
  readonly version: string;
  readonly reversible?: boolean;
  readonly streaming?: boolean;
  process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress', context?: StreamPluginContext): Duplex;
  retryOptions?: RetryOptions;
}

export type PluginOperation = 'process' | 'reverse' | 'stream';

/** Normalized, runtime-validated operations exposed by a plugin. */
export interface PluginCapabilities {
  readonly process: true;
  readonly reverse: boolean;
  readonly streaming: boolean;
  readonly streamMode: 'native' | 'fallback' | 'none';
}

/** Capability view for a plugin registered with a DataEngine. */
export interface RegisteredPluginCapabilities extends PluginCapabilities {
  readonly plugin: string;
}

export interface EngineResult {
  readonly data:         Buffer;
  readonly originalType: string;
  readonly pipeline:     string[];
  readonly metrics:      { durationMs: number; steps: Record<string, number> };
}

// ─── Manifest — written as first msgpack frame in every binary output ─────────

export interface PipeXManifest {
  readonly __pipex_v: 1;
  readonly plugins:   string[];   // name@version in execution order
  readonly ts:        number;     // unix ms
}

export function isManifest(value: unknown): value is PipeXManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['__pipex_v'] === 1
    && Array.isArray(record['plugins'])
    && record['plugins'].length <= 256
    && record['plugins'].every(plugin => typeof plugin === 'string' && plugin.length <= 256)
    && typeof record['ts'] === 'number'
    && Number.isSafeInteger(record['ts'])
    && record['ts'] >= 0;
}

// ─── Engine events ────────────────────────────────────────────────────────────

export interface EngineEvents {
  start:          [requestId: string];
  'plugin:after': [name: string, durationMs: number];
  progress:       [bytes: number, requestId: string];
  error:          [err: Error, requestId: string];
  end:            [requestId: string, durationMs: number];
}
