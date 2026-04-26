export interface ProcessorContext {
  requestId: string;
  timestamp: number;
  metadata: Record<string, any>;
}

export interface ProcessorPlugin {
  readonly name: string;
  readonly version: string;
  process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): any;
}

export interface EngineResult {
  data: Buffer;
  hash: string;
  pipeline: string[];
  metrics: {
    durationMs: number;
    steps: Record<string, number>;
  };
}