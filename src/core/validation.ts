import { z } from 'zod';
import { BasePlugin } from './plugin.js';
import { UNPACKR } from './core.js';
import { pluginInputLimit, pluginOutputLimit } from './resourceLimits.js';
import type { ProcessorContext, StreamPluginContext } from './types.js';
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

  public override async process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    this.validate(data, Math.min(pluginInputLimit(ctx), pluginOutputLimit(ctx)));
    return data;
  }

  public override async reverse(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const maxBytes = Math.min(pluginInputLimit(ctx), pluginOutputLimit(ctx));
    if (data.length > maxBytes) throw new Error(`[PipeX] Validation input exceeds ${maxBytes} bytes`);
    if (this.options.validateOnReverse) {
      this.validate(data, maxBytes);
    }
    return data;
  }

  private validate(data: Buffer, maxBytes: number): void {
    if (data.length > maxBytes) throw new Error(`[PipeX] Validation input exceeds ${maxBytes} bytes`);
    let decoded: unknown;
    try {
      decoded = UNPACKR.unpack(data);
    } catch {
      throw new Error('[PipeX] Validation: invalid MessagePack input');
    }

    const result = this.options.schema.safeParse(decoded);
    if (!result.success) {
      throw new Error('[PipeX] Validation failed');
    }
  }

  public createStream(_mode?: 'compress' | 'decompress', context?: StreamPluginContext): Transform {
    const chunks: Buffer[] = [];
    let total = 0;
    const maxBytes = Math.min(pluginInputLimit(context), pluginOutputLimit(context));
    return new Transform({
      transform(chunk, _enc, cb) {
        if (chunk.length > maxBytes - total) {
          return cb(new Error(`[PipeX] Validation input exceeds ${maxBytes} bytes`));
        }
        total += chunk.length;
        chunks.push(chunk);
        cb();
      },
      flush: (cb) => {
        try {
          const data = Buffer.concat(chunks, total);
          this.validate(data, maxBytes);
          cb(null, data);
        } catch (error) { cb(error as Error); }
      },
    });
  }
}
