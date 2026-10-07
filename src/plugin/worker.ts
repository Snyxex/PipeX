import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { Transform, type TransformCallback } from 'node:stream';
import { Piscina } from 'piscina';
import { BasePlugin } from '../core/plugin.js';
import { DEFAULT_LIMITS, pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';
import {
  OperationAbortedError,
  OperationTimeoutError,
  UnsupportedReverseError,
  WorkerPoolClosedError,
  WorkerPoolCloseError,
  WorkerQueueFullError,
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

const MAX_TIMER_MS = 0x7fff_ffff;
const MAX_THREADS = 128;
const MAX_QUEUE = 100_000;
const DEFAULT_MAX_QUEUE = 64;
const DEFAULT_MAX_THREADS = Math.max(1, Math.min(4, availableParallelism()));

function validateInteger(value: number | undefined, name: string, allowZero = false): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`[PipeX] Worker pool ${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
}

function taskControl(context: ProcessorContext, configuredTimeoutMs: number | undefined): {
  signal: AbortSignal | undefined;
  cleanup(): void;
} {
  const timeoutMs = configuredTimeoutMs
    ?? context.limits?.operationTimeoutMs
    ?? DEFAULT_LIMITS.operationTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMER_MS) {
    throw new Error('[PipeX] Invalid worker task timeout');
  }
  if (timeoutMs === 0) return { signal: context.signal, cleanup() {} };
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new DOMException('Worker task timed out', 'TimeoutError'));
  }, timeoutMs);
  timer.unref();
  return {
    signal: context.signal
      ? AbortSignal.any([context.signal, timeoutController.signal])
      : timeoutController.signal,
    cleanup() { clearTimeout(timer); },
  };
}

function abortError(signal: AbortSignal): OperationAbortedError | OperationTimeoutError {
  return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? new OperationTimeoutError({ cause: signal.reason })
    : new OperationAbortedError({ cause: signal.reason });
}

/** Runs caller-owned CPU transforms in a bounded, persistent Piscina pool. */
export class WorkerPoolPlugin extends BasePlugin {
  public readonly name = 'worker-pool';
  public readonly version = '5.0.0';
  readonly #pool: Piscina<ArrayBuffer, ArrayBuffer | Uint8Array>;
  readonly #processName?: string;
  readonly #reverseName?: string;
  readonly #taskTimeoutMs: number | undefined;
  readonly #maxThreads: number;
  readonly #maxQueue: number;
  readonly #maxInFlight: number;
  readonly #closeTimeoutMs: number;
  readonly #reversible: boolean;
  #accepting = true;
  #inFlight = 0;
  #closePromise?: Promise<void>;
  #fatalError?: WorkerTaskError;
  readonly #idleWaiters = new Set<() => void>();
  readonly #onPoolError: (error: Error) => void;

  constructor(options: WorkerPoolOptions) {
    super(options);
    if (!options || !(typeof options.filename === 'string' || options.filename instanceof URL)) {
      throw new Error('[PipeX] Worker pool requires a worker filename');
    }
    validateInteger(options.maxThreads, 'maxThreads');
    validateInteger(options.maxQueue, 'maxQueue');
    validateInteger(options.taskTimeoutMs, 'taskTimeoutMs', true);
    validateInteger(options.closeTimeoutMs, 'closeTimeoutMs', true);
    if (options.maxThreads !== undefined && options.maxThreads > MAX_THREADS) {
      throw new Error(`[PipeX] Worker pool maxThreads cannot exceed ${MAX_THREADS}`);
    }
    if (options.maxQueue !== undefined && options.maxQueue > MAX_QUEUE) {
      throw new Error(`[PipeX] Worker pool maxQueue cannot exceed ${MAX_QUEUE}`);
    }
    if (options.taskTimeoutMs !== undefined && options.taskTimeoutMs > MAX_TIMER_MS) {
      throw new Error('[PipeX] Worker pool taskTimeoutMs exceeds the supported timer range');
    }
    if (options.closeTimeoutMs !== undefined && options.closeTimeoutMs > MAX_TIMER_MS) {
      throw new Error('[PipeX] Worker pool closeTimeoutMs exceeds the supported timer range');
    }
    for (const [name, value] of [['processName', options.processName], ['reverseName', options.reverseName]] as const) {
      if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > 128)) {
        throw new Error(`[PipeX] Worker pool ${name} must be a non-empty export name`);
      }
    }

    const filename = options.filename instanceof URL ? fileURLToPath(options.filename) : options.filename;
    this.#processName = options.processName;
    this.#reverseName = options.reverseName;
    this.#taskTimeoutMs = options.taskTimeoutMs;
    this.#maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;
    this.#maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.#maxInFlight = this.#maxThreads + this.#maxQueue;
    this.#closeTimeoutMs = options.closeTimeoutMs ?? 30_000;
    this.#reversible = Boolean(options.reverseName);
    this.#pool = new Piscina<ArrayBuffer, ArrayBuffer | Uint8Array>({
      filename,
      minThreads: 0,
      maxThreads: this.#maxThreads,
      maxQueue: this.#maxQueue,
      closeTimeout: this.#closeTimeoutMs,
    });
    this.#onPoolError = error => {
      if (this.#fatalError) return;
      this.#fatalError = new WorkerTaskError('worker-thread', { cause: error });
      this.#accepting = false;
      void this.#pool.destroy().catch(() => undefined);
    };
    this.#pool.on('error', this.#onPoolError);
  }

  public override get reversible(): boolean {
    return this.#reversible;
  }

  async #run(data: Buffer, ctx: ProcessorContext, exportName?: string): Promise<Buffer> {
    if (this.#fatalError) throw this.#fatalError;
    if (!this.#accepting) throw new WorkerPoolClosedError();
    const maxInputBytes = pluginInputLimit(ctx);
    if (data.length > maxInputBytes) {
      throw new Error(`[PipeX] Worker input exceeds ${maxInputBytes} bytes`);
    }
    if (this.#inFlight >= this.#maxInFlight) throw new WorkerQueueFullError(this.#maxQueue);
    const control = taskControl(ctx, this.#taskTimeoutMs);
    this.#inFlight++;

    try {
      control.signal?.throwIfAborted();
      const taskBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const result = await this.#pool.run(taskBuffer, {
        transferList: [taskBuffer],
        signal: control.signal,
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
      if (control.signal?.aborted) throw abortError(control.signal);
      if (error instanceof WorkerPoolClosedError || error instanceof WorkerQueueFullError) throw error;
      if (error instanceof Error
        && (error.message === 'Task queue is at limit'
          || error.message === 'No task queue available and all Workers are busy')) {
        throw new WorkerQueueFullError(this.#maxQueue);
      }
      throw new WorkerTaskError(exportName ?? 'default', { cause: error });
    } finally {
      control.cleanup();
      this.#inFlight--;
      if (this.#inFlight === 0) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
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
    if (mode === 'decompress' && !this.#reverseName) throw new UnsupportedReverseError(this.name);
    const streamController = new AbortController();
    const signal = context?.signal
      ? AbortSignal.any([context.signal, streamController.signal]) : streamController.signal;
    const limits = context?.limits ?? DEFAULT_LIMITS;
    const maxFrame = Math.min(limits.maxFrameBytes, 0xffff_fffe);
    const magic = Buffer.from([0x50, 0x58, 0x57, 0x4b, 1]); // PXWK v1
    const end = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    let inputBytes = 0;
    let outputBytes = 0;
    let frames = 0;
    let started = false;
    let ended = false;
    let header = Buffer.alloc(magic.length);
    let headerBytes = 0;
    let payload: Buffer | undefined;
    let payloadBytes = 0;
    const plugin = this;
    const emit = (stream: Transform, bytes: Buffer) => {
      if (bytes.length > limits.maxOutputBytes - outputBytes) throw new Error('[PipeX] Worker stream output exceeds configured limit');
      outputBytes += bytes.length;
      stream.push(bytes);
    };
    const run = async (data: Buffer): Promise<Buffer> => {
      if (++frames > limits.maxFrames) throw new Error('[PipeX] Worker frame count exceeds configured limit');
      const ctx: ProcessorContext = {
        requestId: context?.requestId ?? 'worker-stream', timestamp: Date.now(), signal,
        limits, logger: context?.logger, metadata: {},
      };
      const task = mode === 'decompress' ? plugin.reverse(data, ctx) : plugin.process(data, ctx);
      context?.track?.(task);
      const output = await task;
      signal.throwIfAborted();
      if (output.length > maxFrame) throw new Error('[PipeX] Worker frame exceeds configured limit');
      return output;
    };
    return new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        const stream = this;
        void (async () => {
          signal.throwIfAborted();
          if (chunk.length > pluginInputLimit(context) - inputBytes) throw new Error('[PipeX] Worker stream input exceeds configured limit');
          inputBytes += chunk.length;
          if (mode === 'compress') {
            if (!started) { emit(stream, magic); started = true; }
            for (let offset = 0; offset < chunk.length; offset += maxFrame) {
              const output = await run(chunk.subarray(offset, offset + maxFrame));
              const length = Buffer.alloc(4);
              length.writeUInt32BE(output.length);
              emit(stream, length);
              emit(stream, output);
            }
            return;
          }
          let offset = 0;
          while (offset < chunk.length) {
            if (ended) throw new Error('[PipeX] Worker stream has trailing bytes');
            if (!payload) {
              const count = Math.min(header.length - headerBytes, chunk.length - offset);
              chunk.copy(header, headerBytes, offset, offset + count);
              headerBytes += count;
              offset += count;
              if (headerBytes !== header.length) continue;
              if (!started) {
                if (!header.equals(magic)) throw new Error('[PipeX] Invalid worker stream format');
                started = true;
                header = Buffer.alloc(4);
                headerBytes = 0;
                continue;
              }
              const length = header.readUInt32BE();
              headerBytes = 0;
              if (length === 0xffff_ffff) { ended = true; continue; }
              if (length > maxFrame) throw new Error('[PipeX] Worker frame exceeds configured limit');
              payload = Buffer.alloc(length);
              payloadBytes = 0;
            }
            const count = Math.min(payload.length - payloadBytes, chunk.length - offset);
            chunk.copy(payload, payloadBytes, offset, offset + count);
            payloadBytes += count;
            offset += count;
            if (payloadBytes === payload.length) {
              emit(stream, await run(payload));
              payload = undefined;
              payloadBytes = 0;
            }
          }
        })().then(() => callback(), error => callback(error as Error));
      },
      flush(callback) {
        try {
          signal.throwIfAborted();
          if (mode === 'compress') {
            if (!started) emit(this, magic);
            emit(this, end);
          } else if (!ended || payload || headerBytes) throw new Error('[PipeX] Incomplete worker stream');
          callback();
        } catch (error) { callback(error as Error); }
      },
      destroy(error, callback) {
        if (!signal.aborted) streamController.abort(error ?? new DOMException('Worker stream destroyed', 'AbortError'));
        payload = undefined;
        callback(error);
      },
    });
  }

  /** Rejects new tasks and waits for queued/running work unless force is true. */
  public async close(options: { force?: boolean } = {}): Promise<void> {
    if (!options || (options.force !== undefined && typeof options.force !== 'boolean')) {
      throw new TypeError('[PipeX] Worker pool close force must be a boolean');
    }
    if (this.#closePromise) return this.#closePromise;
    this.#accepting = false;
    this.#closePromise = (async () => {
      try {
        if (this.#fatalError) await this.#pool.destroy();
        else if (options.force) await this.#pool.destroy();
        else {
          if (this.#inFlight > 0) {
            await new Promise<void>((resolve, reject) => {
              const onIdle = () => { clearTimeout(timer); resolve(); };
              const timer = setTimeout(() => {
                this.#idleWaiters.delete(onIdle);
                reject(new WorkerPoolCloseError());
              }, this.#closeTimeoutMs);
              this.#idleWaiters.add(onIdle);
            });
          }
          await this.#pool.close({ force: false });
          if (this.#fatalError) throw this.#fatalError;
        }
      } catch (error) {
        await this.#pool.destroy().catch(() => undefined);
        throw error instanceof WorkerPoolCloseError
          ? error
          : new WorkerPoolCloseError({ cause: error });
      } finally {
        this.#pool.removeListener('error', this.#onPoolError);
      }
    })();
    return this.#closePromise;
  }
}
