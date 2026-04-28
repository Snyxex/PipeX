import type { ProcessorPlugin, ProcessorContext } from '../core/types.js';

export class BenchmarkPlugin implements ProcessorPlugin {
  public readonly name    = 'performance';
  public readonly version = '1.0.0';

  public async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    context.metadata['inputBytes'] = data.length;
    context.metadata['inputKB']    = Math.round(data.length / 1024 * 100) / 100;
    return data;
  }

  public reverse(data: Buffer, _context: ProcessorContext): Buffer {
    return data;
  }
}