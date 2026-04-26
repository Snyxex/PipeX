import { createHash, randomUUID } from 'crypto';
import { pipeline, Readable, Writable, Transform } from 'stream';
import { promisify } from 'util';
import type { ProcessorPlugin, EngineResult, ProcessorContext } from './types';

const pipelineAsync = promisify(pipeline);

export class DataEngine {
  private plugins: ProcessorPlugin[] = [];

  public use(plugin: ProcessorPlugin): this {
    this.plugins.push(plugin);
    return this;
  }

  /**
   * Für kleine Daten (Buffer-basiert)
   */
  public async run(input: Buffer | string): Promise<EngineResult> {
    const startTime = Date.now();
    let data = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    
    const context: ProcessorContext = {
      requestId: randomUUID(),
      timestamp: startTime,
      metadata: {}
    };

    const metrics: Record<string, number> = {};

    for (const plugin of this.plugins) {
      const stepStart = Date.now();
      data = await plugin.process(data, context);
      metrics[plugin.name] = Date.now() - stepStart;
    }

    return {
      data,
      hash: createHash('sha256').update(data).digest('hex'),
      pipeline: this.plugins.map(p => `${p.name}@${p.version}`),
      metrics: { durationMs: Date.now() - startTime, steps: metrics }
    };
  }

  /**
   * Für große Daten (Stream-basiert)
   * Nutzt Transform-Streams für jedes Plugin
   */
  public async stream(input: Readable, output: Writable): Promise<void> {
    const context: ProcessorContext = {
      requestId: randomUUID(),
      timestamp: Date.now(),
      metadata: { mode: 'stream' }
    };

    // Wir wickeln jedes Plugin in einen Transform-Stream ein
    const transforms = this.plugins.map(plugin => {
      return new Transform({
        async transform(chunk, encoding, callback) {
          try {
            // Hinweis: Plugins müssen für Streams evtl. angepasst werden 
            // oder wir verarbeiten die Chunks hier einzeln.
            const processed = await plugin.process(chunk, context);
            callback(null, processed);
          } catch (err: any) {
            callback(err);
          }
        }
      });
    });

    await pipelineAsync(input, ...transforms, output);
  }

  /**
   * Umkehrung der Pipeline
   */
  public async undo(input: Buffer): Promise<Buffer> {
    let data = input;
    const context: ProcessorContext = {
      requestId: 'undo-' + randomUUID(),
      timestamp: Date.now(),
      metadata: {}
    };

    const reversePipeline = [...this.plugins].reverse();

    for (const plugin of reversePipeline) {
      if (plugin.reverse) {
        data = await plugin.reverse(data, context);
      }
    }

    return data;
  }
}