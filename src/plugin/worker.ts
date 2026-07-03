import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Transform } from 'node:stream';
import { Piscina } from 'piscina';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workerFile = existsSync(join(__dirname, 'worker_piscina.mjs'))
  ? join(__dirname, 'worker_piscina.mjs')
  : join(__dirname, 'worker_piscina.js');

export interface WorkerPoolOptions {
  maxThreads?: number;
}

/**
 * WorkerPoolPlugin — Offloads heavy CPU tasks to a persistent warm worker pool using Piscina.
 */
export class WorkerPoolPlugin extends BasePlugin {
  public readonly name = 'worker-pool';
  public readonly version = '3.0.0';

  private pool: Piscina;

  constructor(options: WorkerPoolOptions = {}) {
    super(options);
    this.pool = new Piscina({
      filename: workerFile,
      maxThreads: options.maxThreads,
    });
  }

  public override async process(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    // Transfer the buffer to the worker pool
    const ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);
    const resultAb = await this.pool.run(ab);
    return Buffer.from(resultAb as ArrayBuffer);
  }

  public override async reverse(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    return this.process(data, _ctx);
  }

  public createStream(): Transform {
    return new Transform({
      transform: async (chunk: Buffer, _enc, cb) => {
        try {
          const res = await this.process(chunk, {} as any);
          cb(null, res);
        } catch (e) {
          cb(e as Error);
        }
      }
    });
  }
}
