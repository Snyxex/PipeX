import { fileURLToPath } from 'node:url';
import { Transform, type TransformCallback } from 'node:stream';
import { Piscina } from 'piscina';
import { BasePlugin } from '../core/plugin.js';
import { pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';
import {
  OperationAbortedError,
  OperationTimeoutError,
  UnsupportedReverseError,
  WorkerPoolClosedError,
  WorkerTaskError,
} from '../core/errors.js';

export interface WorkerPoolOptions {
  /** Absolute path or file URL to a caller-owned ESM/CJS worker module. */
  filename: string | URL;
  /** Export used for forward processing. Omit to use the worker's default export. */
  processName?: string;
  /** Export used for reverse processing. When omitted, reverse is unsupported. */
  reverseName?: string;
  maxThreads?: number;
  /** Maximum queued tasks. Defaults to 64. */
  maxQueue?: number;
  /** Per-task timeout in milliseconds. Zero disables the plugin-level timeout. */
  taskTimeoutMs?: number;
  /** Grace period used by Piscina when closing the pool. Defaults to 30 seconds. */
  closeTimeoutMs?: number;
}

function validateInteger(value: number | undefined, name: string, allowZero = false): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`[PipeX] Worker pool ${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
}

function abortError(signal: AbortSignal): OperationAbortedError | OperationTimeoutError {
  return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? new OperationTimeoutError({ cause: signal.reason })
    : new OperationAbortedError({ cause: signal.reason });
}

/** Runs caller-owned CPU transforms in a bounded, persistent Piscina pool. */
export class WorkerPoolPlugin extends BasePlugin {
  public readonly name = 'worker-pool';
  public readonly version = '4.0.0';
  readonly #pool: Piscina<ArrayBuffer, ArrayBuffer | Uint8Array>;
  readonly #processName?: string;
  readonly #reverseName?: string;
  readonly #taskTimeoutMs: number;
  readonly #reversible: boolean;
  #closed = false;

  constructor(options: WorkerPoolOptions) {
    super(options);
    if (!options || !(typeof options.filename === 'string' || options.filename instanceof URL)) {
      throw new Error('[PipeX] Worker pool requires a worker filename');
    }
    validateInteger(options.maxThreads, 'maxThreads');
    validateInteger(options.maxQueue, 'maxQueue');
    validateInteger(options.taskTimeoutMs, 'taskTimeoutMs', true);
    validateInteger(options.closeTimeoutMs, 'closeTimeoutMs', true);
    for (const [name, value] of [['processName', options.processName], ['reverseName', options.reverseName]] as const) {
      if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > 128)) {
        throw new Error(`[PipeX] Worker pool ${name} must be a non-empty export name`);
      }
    }

    const filename = options.filename instanceof URL ? fileURLToPath(options.filename) : options.filename;
    this.#processName = options.processName;
    this.#reverseName = options.reverseName;
    this.#taskTimeoutMs = options.taskTimeoutMs ?? 0;
    this.#reversible = Boolean(options.reverseName);
    this.#pool = new Piscina<ArrayBuffer, ArrayBuffer | Uint8Array>({
      filename,
      maxThreads: options.maxThreads,
      maxQueue: options.maxQueue ?? 64,
      closeTimeout: options.closeTimeoutMs ?? 30_000,
    });
  }

  public override get reversible(): boolean {
    return this.#reversible;
  }

  async #run(data: Buffer, ctx: ProcessorContext, exportName?: string): Promise<Buffer> {
    if (this.#closed) throw new WorkerPoolClosedError();
    const maxInputBytes = pluginInputLimit(ctx);
    if (data.length > maxInputBytes) {
      throw new Error(`[PipeX] Worker input exceeds ${maxInputBytes} bytes`);
    }

    const taskBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const timeoutSignal = this.#taskTimeoutMs > 0 ? AbortSignal.timeout(this.#taskTimeoutMs) : undefined;
    const signals = [ctx.signal, timeoutSignal].filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    try {
      signal?.throwIfAborted();
      const result = await this.#pool.run(taskBuffer, {
        transferList: [taskBuffer],
        signal,
        name: exportName,
      } as any);
      if (!(result instanceof ArrayBuffer) && !ArrayBuffer.isView(result)) {
        throw new Error('worker returned a non-binary value');
      }
      const output = result instanceof ArrayBuffer
        ? Buffer.from(result)
        : Buffer.from(result.buffer, result.byteOffset, result.byteLength);
      const maxOutputBytes = pluginOutputLimit(ctx);
      if (output.length > maxOutputBytes) {
        throw new Error(`[PipeX] Worker output exceeds ${maxOutputBytes} bytes`);
      }
      return output;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (error instanceof WorkerPoolClosedError) throw error;
      throw new WorkerTaskError(exportName ?? 'default', { cause: error });
    }
  }

  public override process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    return this.#run(data, ctx, this.#processName);
  }

  public override reverse(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    if (!this.#reverseName) throw new UnsupportedReverseError(`${this.name}@${this.version}`);
    return this.#run(data, ctx, this.#reverseName);
  }

  public createStream(mode: 'compress' | 'decompress', context?: StreamPluginContext): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) => {
        const ctx: ProcessorContext = {
          requestId: context?.requestId ?? 'worker-stream',
          timestamp: Date.now(),
          signal: context?.signal,
          limits: context?.limits,
          logger: context?.logger,
          metadata: {},
        };
        const task = mode === 'decompress' ? this.reverse(chunk, ctx) : this.process(chunk, ctx);
        void task.then(output => callback(null, output), error => callback(error as Error));
      },
    });
  }

  /** Rejects new tasks and waits for queued/running work unless force is true. */
  public async close(options: { force?: boolean } = {}): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.close({ force: options.force ?? false });
  }
}
