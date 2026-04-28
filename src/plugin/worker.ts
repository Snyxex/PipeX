import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import type { ProcessorPlugin, ProcessorContext } from '../core/types.js';

const __filename = fileURLToPath(import.meta.url);

export class WorkerPoolPlugin implements ProcessorPlugin {
  readonly name    = 'multi-core-processor';
  readonly version = '1.3.0';

  private readonly threadLimit: number;

  constructor(options: { maxThreads?: number } = {}) {
    const logicalCores = availableParallelism();

   
    const requested = options.maxThreads ?? Math.max(1, logicalCores - 2);
    this.threadLimit = Math.max(1, Math.min(requested, logicalCores));
 
  }


  public createStream(mode: 'compress' | 'decompress'): Transform {
    const plugin = this;

    return new Transform({
      async transform(chunk: Buffer, _encoding, callback) {
        try {
          const context: ProcessorContext = {
            requestId: randomUUID(),
            timestamp: Date.now(),
            metadata: {}
          };
          const processed = await plugin.process(chunk, context);
          callback(null, processed);
        } catch (err: any) {
          callback(err);
        }
      }
    });
  }


  public async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    if (!isMainThread) return data;

    if (data.length === 0) return data;

  
    const threadCount = Math.min(this.threadLimit, data.length);
  
    const chunkSize = Math.ceil(data.length / threadCount);
    const promises: Promise<Buffer>[] = [];

    for (let i = 0; i < threadCount; i++) {
      const start = i * chunkSize;
      if (start >= data.length) break;
      const end = Math.min(start + chunkSize, data.length);

   
      promises.push(this.runWorker(data.subarray(start, end)));
    }

    const results = await Promise.all(promises);
    return Buffer.concat(results);
  }

  private runWorker(chunk: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename);

     
      const ab = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      );

      worker.postMessage(ab, [ab] as any);

     
      let settled = false;

      worker.on('message', (msg: ArrayBuffer) => {
        if (settled) return;
        settled = true;
        resolve(Buffer.from(msg));
   
        worker.terminate().catch(() => {});
      });

      worker.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      worker.on('exit', (code) => {
        if (settled) return;
       
        if (code !== 0) {
          settled = true;
          reject(new Error(`[${this.name}] Worker exited with code ${code}`));
        }
      
        else {
          settled = true;
          resolve(Buffer.alloc(0));
        }
      });
    });
  }

  public async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
  
    return this.process(data, context);
  }

  
  public static listenAndProcess(): void {
    if (isMainThread || !parentPort) return;

    parentPort.on('message', (arrayBuffer: ArrayBuffer) => {
      const buffer = Buffer.from(arrayBuffer);

    
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = (buffer[i] as number) ^ 0x42;
      }

    
      const outAb = buffer.buffer;
      parentPort!.postMessage(outAb, [outAb] as any);
    });
  }
}

if (!isMainThread) {
  WorkerPoolPlugin.listenAndProcess();
}