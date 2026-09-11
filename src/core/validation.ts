import { z } from 'zod';
import { BasePlugin } from './plugin.js';
import { UNPACKR } from './core.js';
import type { ProcessorContext } from './types.js';
import { Transform } from 'node:stream';

export interface ValidationOptions {
  schema: z.ZodType<any>;
  /** 
   * Whether to validate during the reverse (decompress) phase. 
   * Useful if you want to ensure the restored data still matches the schema.
   */
  validateOnReverse?: boolean;
}

/**
 * ValidationPlugin — Core plugin for schema-based data validation.
 * Uses Zod to verify the structure of the data passing through the engine.
 * 
 * Note: This plugin assumes the data is MsgPack-encoded (default PipeX behavior).
 */
export class ValidationPlugin extends BasePlugin {
  public readonly name = 'validation';
  public readonly version = '1.0.0';

  constructor(protected override options: ValidationOptions) {
    super(options);
  }

  public override async process(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    this.validate(data);
    return data;
  }

  public override async reverse(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    if (this.options.validateOnReverse) {
      this.validate(data);
    }
    return data;
  }

  private validate(data: Buffer): void {
    let decoded: unknown;
    try {
      decoded = UNPACKR.unpack(data);
    } catch (e) {
      throw new Error(`[PipeX] Validation: Failed to decode data for validation — ${(e as Error).message}`);
    }

    const result = this.options.schema.safeParse(decoded);
    if (!result.success) {
      throw new Error(`[PipeX] Validation failed: ${result.error.message}`);
    }
  }

  public createStream(): Transform {
    const chunks: Buffer[] = [];
    let total = 0;
    return new Transform({
      transform(chunk, _enc, cb) {
        total += chunk.length;
        if (total > 64 * 1024 * 1024) return cb(new Error('[PipeX] Validation input exceeds 64 MiB'));
        chunks.push(chunk);
        cb();
      },
      flush: (cb) => {
        try {
          this.validate(Buffer.concat(chunks));
          cb(null, Buffer.concat(chunks));
        } catch (error) { cb(error as Error); }
      },
    });
  }
}
