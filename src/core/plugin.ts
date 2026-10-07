import type { ProcessorPlugin, ProcessorContext, RetryOptions } from './types.js';
import { UnsupportedReverseError } from './errors.js';

export abstract class BasePlugin<TOptions = any> implements ProcessorPlugin {
  abstract readonly name: string;
  abstract readonly version: string;
  public retryOptions?: RetryOptions;

  public get reversible(): boolean {
    return this.reverse !== BasePlugin.prototype.reverse;
  }

  constructor(protected options: TOptions = {} as TOptions) {}

  abstract process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;

  /** Unsupported by default. Subclasses must implement reverse explicitly. */
  reverse(_data: Buffer, _context: ProcessorContext): Promise<Buffer> | Buffer {
    throw new UnsupportedReverseError(`${this.name}@${this.version}`);
  }
}
