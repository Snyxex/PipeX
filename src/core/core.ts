/**
 * core.ts — stateless pipeline primitives
 *
 * No class, no EventEmitter, no file I/O.
 * Everything here is a pure function or a stream factory.
 * Controllers and the Engine import from here — never the other way around.
 */

import { randomUUID }                                            from 'node:crypto';
import { pipeline }                                              from 'node:stream/promises';
import { Readable, Writable, Transform, type TransformCallback } from 'node:stream';
import { Packr, Unpackr, PackrStream, UnpackrStream }            from 'msgpackr';
import { 
  type ProcessorPlugin, 
  type ProcessorContext, 
  type PipeXManifest,
  type Logger,
  type Tracer,
  type Span,
  type RetryOptions,
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
): Promise<T> {
  const { attempts = 1, backoff = 'fixed', delayMs = 0 } = options ?? {};
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        const nextDelay = backoff === 'exponential' ? delayMs * Math.pow(2, i) : delayMs;
        logger?.debug(`[PipeX] Retry ${i + 1}/${attempts} after ${nextDelay}ms`, { error: lastError.message });
        if (nextDelay > 0) await new Promise(resolve => setTimeout(resolve, nextDelay));
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

// ─── Type helpers ─────────────────────────────────────────────────────────────

type PluginWithStream = ProcessorPlugin & {
  createStream(mode: 'compress' | 'decompress'): Transform;
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
): ProcessorContext {
  return { requestId, timestamp: Date.now(), metadata: extra, logger, span };
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
        if (isManifest(frame)) { onManifest(frame); cb(); return; }
      }
      cb(null, frame);
    },
  });
}

// ─── Stream factories ─────────────────────────────────────────────────────────

/** DoS-safe UnpackrStream subclass — rejects oversized raw chunks before decode. */
export class GuardedUnpackrStream extends UnpackrStream {
  override _transform(chunk: Buffer, enc: BufferEncoding, cb: TransformCallback): void {
    if (chunk.length > MAX_FRAME_BYTES) {
      cb(new Error(`[PipeX] Frame too large: ${chunk.length} bytes (max ${MAX_FRAME_BYTES})`));
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
export function createUnpackrStream(): GuardedUnpackrStream {
  return new GuardedUnpackrStream({ useRecords: false });
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
): Transform {
  const requestId = `stream-${randomUUID()}`;
  return new Transform({
    async transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      const span = tracer?.startSpan(`plugin:${plugin.name}`, { requestId } as any);
      span?.setAttribute('plugin.version', plugin.version);
      span?.setAttribute('mode', reverse ? 'reverse' : 'process');

      try {
        const ctx = makeContext(requestId, {}, logger, span);
        const fn  = reverse && typeof plugin.reverse === 'function'
          ? plugin.reverse.bind(plugin)
          : plugin.process.bind(plugin);
        
        const out = await withRetry(() => fn(chunk, ctx), plugin.retryOptions, logger);
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
          dlq.write(chunk);
          cb(); // Drop the chunk from the main pipeline but don't crash
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
): (Transform | PackrStream | GuardedUnpackrStream)[] {
  const ordered = reverse ? [...plugins].reverse() : plugins;
  return ordered.map(plugin =>
    hasStreamSupport(plugin)
      ? plugin.createStream(mode)
      : buildFallbackTransform(plugin, reverse, onProgress, logger, tracer, dlq)
  );
}

// ─── Central pipeline runner ──────────────────────────────────────────────────

/**
 * Runs an arbitrary pipeline: Source → [...Transforms] → Destination.
 * The `any` cast is scoped to this single call site — nowhere else.
 */
export async function runPipeline(
  source:      Readable,
  transforms:  (Transform | PackrStream | GuardedUnpackrStream)[],
  destination: Writable,
): Promise<void> {
  await (pipeline as (...args: unknown[]) => Promise<void>)(
    source, ...transforms, destination
  );
}

// ─── Path safety ──────────────────────────────────────────────────────────────

import path from 'node:path';
import { existsSync } from 'node:fs';

export function assertExists(inputPath: string, allowedRoot?: string): string {
  const abs = path.resolve(inputPath);
  if (allowedRoot) {
    const root = path.resolve(allowedRoot);
    const safe = root.endsWith(path.sep) ? root : root + path.sep;
    if (!abs.startsWith(safe) && abs !== root) {
      throw new Error(`[PipeX] Path traversal denied: "${abs}" outside root "${root}"`);
    }
  }
  if (!existsSync(abs)) throw new Error(`[PipeX] File not found: ${abs}`);
  return abs;
}