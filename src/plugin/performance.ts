import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

/**
 * BenchmarkPlugin — Standard library plugin for monitoring data throughput.
 * Records input/output byte counts in context metadata.
 */
export class BenchmarkPlugin extends BasePlugin {
  public readonly name = 'benchmark';
  public readonly version = '2.0.0';

  public override async process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const start = ctx.metadata['benchmark:start'] as number || Date.now();
    ctx.metadata['benchmark:in_bytes'] = data.length;
    ctx.metadata['benchmark:start'] = start;
    return data;
  }

  public override async reverse(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    ctx.metadata['benchmark:out_bytes'] = data.length;
    const start = ctx.metadata['benchmark:start'] as number;
    if (start) {
      ctx.metadata['benchmark:duration_ms'] = Date.now() - start;
    }
    return data;
  }
}
