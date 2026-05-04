import type { Transform } from 'node:stream';

export interface ProcessorContext {
  requestId: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface ProcessorPlugin {
  readonly name:    string;
  readonly version: string;
  process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): Transform;
}

export interface EngineResult {
  data:         Buffer;
  originalType: string;
  pipeline:     string[];
  metrics: {
    durationMs: number;
    steps:      Record<string, number>;
  };
}