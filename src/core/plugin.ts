import type { ProcessorPlugin, ProcessorContext, RetryOptions } from './types.js';

export abstract class BasePlugin implements ProcessorPlugin {
  abstract readonly name: string;
  abstract readonly version: string;
  public retryOptions?: RetryOptions;

  constructor(protected options: any = {}) {}

  abstract process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;

  // Standardmäßig ein Pass-through, falls nicht überschrieben
  reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> | Buffer {
    return data;
  }
}
