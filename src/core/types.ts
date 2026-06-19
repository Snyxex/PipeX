import type { Transform } from 'node:stream';
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

export interface KmsProvider {
  encrypt(data: Buffer, keyId: string): Promise<Buffer>;
  decrypt(data: Buffer, keyId: string): Promise<Buffer>;
  generateDataKey(keyId: string): Promise<{ plaintext: Buffer; ciphertext: Buffer }>;
}

export interface SchemaRegistry {
  getSchema(subject: string, version?: number): Promise<z.ZodType<any>>;
}

export interface EngineConfig {
  plugins?: { name: string; options?: any }[];
  logging?: { enabled: boolean; level?: string };
  tracing?: { enabled: boolean };
  dlq?:     { path: string };
}

// ─── Core types ───────────────────────────────────────────────────────────────

export interface ProcessorContext {
  readonly requestId: string;
  readonly timestamp: number;
  metadata: Record<string, unknown>;
  logger?:  Logger;
  span?:    Span;
}

export interface ProcessorPlugin {
  readonly name:    string;
  readonly version: string;
  process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): Transform;
  retryOptions?: RetryOptions;
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
  return (
    typeof value === 'object' &&
    value !== null &&
    '__pipex_v' in value &&
    (value as Record<string, unknown>)['__pipex_v'] === 1
  );
}

// ─── Engine events ────────────────────────────────────────────────────────────

export interface EngineEvents {
  start:          [requestId: string];
  'plugin:after': [name: string, durationMs: number];
  progress:       [bytes: number, requestId: string];
  error:          [err: Error, requestId: string];
  end:            [requestId: string, durationMs: number];
}