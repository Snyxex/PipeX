import type { ProcessorPlugin, ProcessorContext } from './types.js';

export abstract class BasePlugin implements ProcessorPlugin {
  abstract readonly name: string;
  abstract readonly version: string;

  constructor(protected options: any = {}) {}

  abstract process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;

  // Standardmäßig ein Pass-through, falls nicht überschrieben
  reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> | Buffer {
    return data;
  }
}
