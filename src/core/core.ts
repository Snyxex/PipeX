/**
 * core.ts — stateless pipeline primitives
 *
 * No class, no EventEmitter, no file I/O.
 * Everything here is a pure function or a stream factory.
 * Controllers and the Engine import from here — never the other way around.
 */

import { randomUUID }                                            from 'node:crypto';
import { pipeline }                                              from 'node:stream/promises';
import { Readable, Writable, Transform, Duplex, type TransformCallback } from 'node:stream';
import { Packr, Unpackr, PackrStream, UnpackrStream }            from 'msgpackr';
import { 
  type ProcessorPlugin, 
  type ProcessorContext, 
  type PipeXManifest,
  type Logger,
  type Tracer,
  type Span,
  type RetryOptions,
  type EngineLimits,
  type StreamPluginContext,
  isManifest 
} from './types.js';

export { isManifest };

// ─── Resilience Helpers ───────────────────────────────────────────────────────

/**
 * Executes a function with automatic retries and backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T> | T,
  options?: RetryOptions,
  logger?: Logger,
  control?: { signal?: AbortSignal; limits?: Pick<EngineLimits, 'maxRetryAttempts' | 'maxRetryDelayMs'> },
): Promise<T> {
  const { attempts = 1, backoff = 'fixed', delayMs = 0 } = options ?? {};
  const maxAttempts = control?.limits?.maxRetryAttempts ?? 5;
  const maxDelay = control?.limits?.maxRetryDelayMs ?? 30_000;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > maxAttempts) {
    throw new Error(`[PipeX] Invalid retry attempts: ${attempts}`);
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > maxDelay) {
    throw new Error(`[PipeX] Invalid retry delay: ${delayMs}`);
  }
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    control?.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        const nextDelay = backoff === 'exponential' ? delayMs * Math.pow(2, i) : delayMs;
        logger?.debug(`[PipeX] Retry ${i + 1}/${attempts} after ${nextDelay}ms`, { error: lastError.message });
        if (nextDelay > 0) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => control?.signal?.removeEventListener('abort', onAbort);
            const timer = setTimeout(() => { cleanup(); resolve(); }, Math.min(nextDelay, maxDelay));
            const onAbort = () => {
              clearTimeout(timer);
              cleanup();
              reject(control?.signal?.reason ?? new Error('[PipeX] Operation aborted'));
            };
            control?.signal?.addEventListener('abort', onAbort, { once: true });
          });
        }
      }
    }
  }

  throw lastError;
}

// Sentinel key constant — single source of truth, importable by controllers
export const PIPEX_MANIFEST_KEY = '__pipex_v' as const;

// ─── Singletons ───────────────────────────────────────────────────────────────
export const PACKR   = new Packr({ useRecords: false });
export const UNPACKR = new Unpackr({ useRecords: false });

export const MAX_FRAME_BYTES    = 256 * 1024 * 1024;
export const DEFAULT_HIGH_WATER = 64  * 1024;
export const DEFAULT_LIMITS: Readonly<EngineLimits> = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxFrameBytes: 8 * 1024 * 1024,
  maxFrames: 100_000,
  maxConcurrentOperations: 32,
  operationTimeoutMs: 5 * 60_000,
  maxRetryAttempts: 5,
  maxRetryDelayMs: 30_000,
});

// ─── Type helpers ─────────────────────────────────────────────────────────────

type PluginWithStream = ProcessorPlugin & {
  createStream(mode: 'compress' | 'decompress', context?: StreamPluginContext): Duplex;
};

export function hasStreamSupport(p: ProcessorPlugin): p is PluginWithStream {
  return typeof p['createStream'] === 'function';
}

// ─── Buffer helpers ───────────────────────────────────────────────────────────

export function detectType(input: unknown): string {
  if (input === null)                                 return 'null';
  if (Buffer.isBuffer(input))                         return 'buffer';
  if (Array.isArray(input))                           return 'array';
  if (typeof input === 'object')                      return 'object';
  return typeof input;
}

export function toBuffer(input: unknown): Buffer {
  if (Buffer.isBuffer(input))                         return input;
  if (input instanceof ArrayBuffer)                   return Buffer.from(input);
  if (typeof input === 'object' && input !== null)    return PACKR.pack(input);
  if (typeof input === 'number' || typeof input === 'boolean') return Buffer.from(String(input));
  return Buffer.from(String(input ?? ''), 'utf-8');
}

export function fromBuffer(buffer: Buffer, targetType: string): unknown {
  // Robustness: if buffer is already decoded (from unpackWithManifest), just return it
  if (typeof buffer !== 'object' || !Buffer.isBuffer(buffer)) {
    if (targetType === 'object' || targetType === 'array' || targetType === 'null') {
      return buffer;
    }
  }

  switch (targetType) {
    case 'array':
    case 'object': {
      try { return UNPACKR.unpack(buffer); }
      catch (e: unknown) {
        throw new Error(`[PipeX] fromBuffer: invalid MsgPack — ${(e as Error).message}`);
      }
    }
    case 'json': { // Legacy support or explicit JSON
      try { return JSON.parse(buffer.toString('utf-8')); }
      catch (e: unknown) {
        throw new Error(`[PipeX] fromBuffer: invalid JSON — ${(e as Error).message}`);
      }
    }
    case 'number': {
      const n = Number(buffer.toString('utf-8'));
      if (isNaN(n)) throw new Error('[PipeX] fromBuffer: cannot convert to number');
      return n;
    }
    case 'boolean': return buffer.toString('utf-8') === 'true';
    case 'string':  return buffer.toString('utf-8');
    case 'null':    return null;
    default:        return buffer;
  }
}

// ─── Context factory ──────────────────────────────────────────────────────────

export function makeContext(
  requestId: string,
  extra: Record<string, unknown> = {},
  logger?: Logger,
  span?:   Span,
  signal?: AbortSignal,
): ProcessorContext {
  return { requestId, timestamp: Date.now(), metadata: extra, logger, span, signal };
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

export function buildManifest(plugins: readonly ProcessorPlugin[]): PipeXManifest {
  return {
    __pipex_v: 1,
    plugins:   plugins.map(p => `${p.name}@${p.version}`),
    ts:        Date.now(),
  };
}

/**
 * A passthrough Transform that prepends a single msgpack-encoded manifest frame
 * to the byte stream before forwarding any data chunks.
 * Inserted between PackrStream output and the file destination.
 */
export function buildManifestHeaderTransform(manifest: PipeXManifest): Transform {
  let sent = false;
  const frame = Buffer.from(PACKR.pack(manifest));

  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      if (!sent) {
        sent = true;
        cb(null, Buffer.concat([frame, chunk]));
      } else {
        cb(null, chunk);
      }
    },
    flush(cb: TransformCallback) {
      if (!sent) this.push(frame);
      cb();
    },
  });
}

/**
 * Object-mode Transform that sits after UnpackrStream.
 * Intercepts the first decoded frame: if it is a PipeXManifest, captures it
 * via onManifest() and drops it from the output; all other frames pass through.
 */
export function buildManifestExtractTransform(
  onManifest: (m: PipeXManifest) => void,
): Transform {
  let seen = false;
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: true,
    transform(frame: unknown, _enc: BufferEncoding, cb: TransformCallback) {
      if (!seen) {
        seen = true;
        if (isManifest(frame)) {
          try { onManifest(frame); cb(); } catch (error) { cb(error as Error); }
          return;
        }
      }
      cb(null, frame);
    },
  });
}

// ─── Stream factories ─────────────────────────────────────────────────────────

/** DoS-safe UnpackrStream subclass — rejects oversized raw chunks before decode. */
export class GuardedUnpackrStream extends UnpackrStream {
  #receivedBytes = 0;
  readonly #maxInputBytes: number;

  constructor(options: Record<string, unknown> = {}, maxInputBytes = DEFAULT_LIMITS.maxInputBytes) {
    super(options);
    this.#maxInputBytes = maxInputBytes;
  }

  override _transform(chunk: Buffer, enc: BufferEncoding, cb: TransformCallback): void {
    this.#receivedBytes += chunk.length;
    if (this.#receivedBytes > this.#maxInputBytes) {
      cb(new Error(`[PipeX] Serialized input exceeds ${this.#maxInputBytes} bytes`));
      return;
    }
    super._transform(chunk, enc, cb);
  }
}

/** PackrStream with useRecords disabled (safe default). */
export function createPackrStream(): PackrStream {
  return new PackrStream({ useRecords: false });
}

/** GuardedUnpackrStream with useRecords disabled. */
export function createUnpackrStream(maxInputBytes = DEFAULT_LIMITS.maxInputBytes): GuardedUnpackrStream {
  return new GuardedUnpackrStream({ useRecords: false }, maxInputBytes);
}

export function buildByteLimitTransform(maxBytes: number, label: string): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new Error(`[PipeX] ${label} exceeds ${maxBytes} bytes`));
        return;
      }
      cb(null, chunk);
    },
  });
}

export function buildObjectLimitTransform(maxFrames: number): Transform {
  let count = 0;
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: true,
    transform(value: unknown, _enc: BufferEncoding, cb: TransformCallback) {
      count++;
      if (count > maxFrames) {
        cb(new Error(`[PipeX] Decoded frame count exceeds ${maxFrames}`));
        return;
      }
      cb(null, value);
    },
  });
}

/**
 * Wraps a plugin's process/reverse call in a Transform.
 * requestId is fixed per stream instance — not per chunk — to avoid
 * 60× randomUUID() overhead on high-throughput paths.
 */
export function buildFallbackTransform(
  plugin:  ProcessorPlugin,
  reverse: boolean,
  emitProgress?: (bytes: number) => void,
  logger?: Logger,
  tracer?: Tracer,
  dlq?:    Writable,
  streamContext?: StreamPluginContext,
): Transform {
  const requestId = streamContext?.requestId ?? `stream-${randomUUID()}`;
  return new Transform({
    async transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      const span = tracer?.startSpan(`plugin:${plugin.name}`, { requestId } as any);
      span?.setAttribute('plugin.version', plugin.version);
      span?.setAttribute('mode', reverse ? 'reverse' : 'process');

      try {
        streamContext?.signal.throwIfAborted();
        const ctx = makeContext(requestId, {}, logger, span, streamContext?.signal);
        if (reverse && typeof plugin.reverse !== 'function') {
          throw new Error(`[PipeX] Plugin ${plugin.name} is not reversible`);
        }
        const fn = reverse ? plugin.reverse!.bind(plugin) : plugin.process.bind(plugin);
        
        const out = await withRetry(
          () => fn(chunk, ctx),
          plugin.retryOptions,
          logger,
          { signal: streamContext?.signal, limits: streamContext?.limits },
        );
        emitProgress?.(out.length);
        span?.addEvent('processed', { bytes: out.length });
        cb(null, out);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger?.error(`[PipeX] Plugin ${plugin.name} failed after retries`, { requestId, error: error.message });
        span?.setAttribute('error', true);
        span?.addEvent('error', { message: error.message });

        if (dlq && dlq.writable) {
          logger?.warn(`[PipeX] Diverting failed chunk to DLQ`, { requestId, plugin: plugin.name });
          try {
            if (!dlq.write(chunk)) await new Promise<void>((resolve, reject) => {
              const onDrain = () => { cleanup(); resolve(); };
              const onError = (writeError: Error) => { cleanup(); reject(writeError); };
              const cleanup = () => {
                dlq.off('drain', onDrain);
                dlq.off('error', onError);
              };
              dlq.once('drain', onDrain);
              dlq.once('error', onError);
            });
            cb(error);
          } catch (dlqError) {
            cb(dlqError as Error);
          }
        } else {
          cb(error);
        }
      } finally {
        span?.end();
      }
    },
  });
}

/** Serialises JS objects to NDJSON lines. */
export function buildNdjsonTransform(): Transform {
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(chunk: unknown, _enc: BufferEncoding, cb: TransformCallback) {
      try { cb(null, JSON.stringify(chunk) + '\n'); }
      catch (e: unknown) {
        cb(new Error(`[PipeX] NDJSON: ${(e as Error).message}`));
      }
    },
  });
}

/**
 * Builds the ordered Transform chain from a plugin list.
 * Uses native createStream() when available; falls back to buildFallbackTransform.
 */
export function buildTransformChain(
  plugins:  readonly ProcessorPlugin[],
  mode:     'compress' | 'decompress',
  reverse   = false,
  onProgress?: (bytes: number) => void,
  logger?: Logger,
  tracer?: Tracer,
  dlq?:    Writable,
  streamContext?: StreamPluginContext,
): (Duplex | Transform | PackrStream | GuardedUnpackrStream)[] {
  const ordered = reverse ? [...plugins].reverse() : plugins;
  return ordered.flatMap((plugin, index) => {
    const transform = hasStreamSupport(plugin)
      ? plugin.createStream(mode, streamContext)
      : buildFallbackTransform(plugin, reverse, onProgress, logger, tracer, dlq, streamContext);
    const limit = buildByteLimitTransform(
      streamContext?.limits.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes,
      `output after plugin ${plugin.name}#${index}`,
    );
    if (!hasStreamSupport(plugin)) return [transform, limit];

    const span = tracer?.startSpan(`plugin:${plugin.name}`, { requestId: streamContext?.requestId ?? 'stream' } as ProcessorContext);
    const observe = new Transform({
      transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
        onProgress?.(chunk.length);
        span?.addEvent('processed', { bytes: chunk.length });
        cb(null, chunk);
      },
      final(cb) {
        span?.end();
        cb();
      },
      destroy(error, cb) {
        if (error) span?.setAttribute('error', true);
        span?.end();
        cb(error);
      },
    });
    return [transform, observe, limit];
  });
}

// ─── Central pipeline runner ──────────────────────────────────────────────────

/**
 * Runs an arbitrary pipeline: Source → [...Transforms] → Destination.
 * The `any` cast is scoped to this single call site — nowhere else.
 */
export async function runPipeline(
  source:      Readable,
  transforms:  (Duplex | Transform | PackrStream | GuardedUnpackrStream)[],
  destination: Writable,
  options?: { signal?: AbortSignal },
): Promise<void> {
  await (pipeline as (...args: unknown[]) => Promise<void>)(
    source, ...transforms, destination, options ?? {}
  );
}

// ─── Path safety ──────────────────────────────────────────────────────────────

import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

function assertWithinRoot(target: string, allowedRoot: string): void {
  const relative = path.relative(allowedRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('[PipeX] Path is outside the allowed root');
  }
}

export function assertExists(inputPath: string, allowedRoot?: string): string {
  const abs = path.resolve(inputPath);
  if (!existsSync(abs)) throw new Error(`[PipeX] File not found: ${abs}`);
  const root = realpathSync.native(path.resolve(allowedRoot ?? process.cwd()));
  const canonical = realpathSync.native(abs);
  assertWithinRoot(canonical, root);
  return canonical;
}

export function resolveOutputPath(outputPath: string, allowedRoot?: string): string {
  const root = realpathSync.native(path.resolve(allowedRoot ?? process.cwd()));
  const absolute = path.resolve(outputPath);
  const parent = realpathSync.native(path.dirname(absolute));
  assertWithinRoot(parent, root);
  const candidate = path.join(parent, path.basename(absolute));
  if (existsSync(candidate)) {
    assertWithinRoot(realpathSync.native(candidate), root);
  }
  return candidate;
}
