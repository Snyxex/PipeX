import type { Transform } from 'node:stream';

// ─── Core types ───────────────────────────────────────────────────────────────

export interface ProcessorContext {
  readonly requestId: string;
  readonly timestamp: number;
  metadata: Record<string, unknown>;
}

export interface ProcessorPlugin {
  readonly name:    string;
  readonly version: string;
  process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): Transform;
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