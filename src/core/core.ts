import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises'; // Nutze die moderne Promise-Version
import { Readable, Writable, Transform } from 'node:stream';
import path from 'node:path';
import type { ProcessorPlugin, EngineResult, ProcessorContext } from './types.js';

export class DataEngine {
  private plugins: ProcessorPlugin[] = [];

  public use(plugin: ProcessorPlugin): this {
    this.plugins.push(plugin);
    return this;
  }

  public async run(input: any): Promise<EngineResult> {
    const startTime = Date.now();
    const originalType = this.detectType(input);
    
    let data = this.toBuffer(input);
    
    const context: ProcessorContext = {
      requestId: randomUUID(),
      timestamp: startTime,
      metadata: { originalType }
    };

    const metrics: Record<string, number> = {};

    for (const plugin of this.plugins) {
      try {
        const stepStart = Date.now();
        data = await plugin.process(data, context);
        metrics[plugin.name] = Date.now() - stepStart;
      } catch (err: any) {
        throw new Error(`[PipeX] Plugin "${plugin.name}" failed: ${err.message}`);
      }
    }

    return {
      data,
      pipeline: this.plugins.map(p => `${p.name}@${p.version}`),
      metrics: { 
        durationMs: Date.now() - startTime, 
        steps: metrics 
      }
    };
  }

  public async undo<T = any>(input: Buffer, forceType?: string): Promise<T> {
    let data = input;
    const context: ProcessorContext = {
      requestId: 'undo-' + randomUUID(),
      timestamp: Date.now(),
      metadata: forceType ? { originalType: forceType } : {} 
    };

    const reversePipeline = [...this.plugins].reverse();

    for (const plugin of reversePipeline) {
      if (typeof plugin.reverse === 'function') {
        try {
          data = await plugin.reverse(data, context);
        } catch (err: any) {
          throw new Error(`[PipeX] Undo failed at "${plugin.name}": ${err.message}`);
        }
      }
    }

    const targetType = forceType || (context.metadata['originalType'] as string) || 'buffer';
    return this.fromBuffer(data, targetType) as T;
  }

  /**
   * Zentralisiert die Pipeline-Logik, um TS-Fehler zu vermeiden
   */
  private async runPipeline(source: Readable, transforms: Transform[], destination: Writable): Promise<void> {
    try {
      if (transforms.length > 0) {
        // Der Cast auf 'any' ist notwendig, da TS Probleme mit dem Spread-Operator bei Pipeline-Typings hat
        await (pipeline as any)(source, ...transforms, destination);
      } else {
        await pipeline(source, destination);
      }
    } catch (err: any) {
      throw err;
    }
  }

  public async stream(input: Readable, output: Writable): Promise<void> {
    const transforms = this.plugins.map(plugin => {
      if (typeof (plugin as any).createStream === 'function') {
        return (plugin as any).createStream('compress');
      }
      // Fallback für Plugins ohne Stream-Support
      return new Transform({
        async transform(chunk, _enc, cb) {
          try {
            const context: ProcessorContext = { requestId: 'stream', timestamp: Date.now(), metadata: {} };
            const result = await plugin.process(chunk, context);
            cb(null, result);
          } catch (err: any) {
            cb(err);
          }
        }
      });
    }) as Transform[];

    await this.runPipeline(input, transforms, output);
  }

  public async processFile(inputPath: string, outputPath: string): Promise<void> {
    const absoluteInputPath = path.resolve(inputPath); 
    if(!existsSync(absoluteInputPath)) {
      throw new Error(`Input file not found: ${absoluteInputPath}`);
    }

    const source = createReadStream(absoluteInputPath, { highWaterMark: 1024 * 1024 }); 
    const destination = createWriteStream(path.resolve(outputPath));

    try {
      await this.stream(source, destination);
    } catch (err: any) {
      throw new Error(`[PipeX] File processing failed: ${err.message}`);
    }
  }

  public async reverseFile(inputPath: string, outputPath: string): Promise<void> {
    const absoluteInputPath = path.resolve(inputPath);
    if (!existsSync(absoluteInputPath)) {
      throw new Error(`Eingabedatei nicht gefunden: ${absoluteInputPath}`);
    }

    const source = createReadStream(absoluteInputPath, { highWaterMark: 1024 * 1024 });
    const destination = createWriteStream(path.resolve(outputPath));

    const transforms = [...this.plugins]
      .reverse()
      .map(plugin => {
        if (typeof (plugin as any).createStream === 'function') {
          return (plugin as any).createStream('decompress');
        }
        // Fallback für Plugins ohne Stream-Support
        return new Transform({
          async transform(chunk, _enc, cb) {
            try {
              const context: ProcessorContext = { requestId: 'reverse-stream', timestamp: Date.now(), metadata: {} };
              const result = await (plugin as any).reverse(chunk, context);
              cb(null, result);
            } catch (err: any) {
              cb(err);
            }
          }
        });
      }) as Transform[]; 

    try {
      await this.runPipeline(source, transforms, destination);
    } catch (err: any) {
      throw new Error(`[PipeX] reverseFile failed: ${err.message}`);
    }
  }

  // --- Hilfsmethoden ---

  private detectType(input: any): string {
    if (Buffer.isBuffer(input)) return 'buffer';
    if (Array.isArray(input) || (typeof input === 'object' && input !== null)) return 'json';
    return typeof input;
  }

  private toBuffer(input: any): Buffer {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    if (typeof input === 'object' && input !== null) return Buffer.from(JSON.stringify(input));
    if (typeof input === 'number' || typeof input === 'boolean') return Buffer.from(String(input));
    return Buffer.from(String(input || ''), 'utf-8');
  }

  private fromBuffer(buffer: Buffer, targetType: string): any {
    const raw = buffer.toString('utf-8');
    switch (targetType) {
      case 'json':
        try { return JSON.parse(raw); } catch { return buffer; }
      case 'number': 
        const num = Number(raw);
        if (isNaN(num)) throw new Error(`Failed to convert data to number`);
        return num;
      case 'boolean': 
        return raw === 'true';
      case 'string': 
        return raw;
      default: 
        return buffer;
    }
  }
}