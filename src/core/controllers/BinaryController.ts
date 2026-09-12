/**
 * BinaryController — in-memory binary operations
 *
 * engine.binary.pack(data)     → Buffer (msgpack)
 * engine.binary.unpack(buf)    → T
 * engine.binary.run(input)     → EngineResult  (plugin pipeline)
 * engine.binary.undo(result)   → T             (round-trip, self-healing)
 */

import type { DataEngine }     from '../dataEngine.js';
import {
  PACKR,
  UNPACKR,
  detectType,
  toBuffer,
  fromBuffer,
  makeContext,
  withRetry,
  buildManifest,
  isManifest,
  assertReversiblePipeline,
} from '../core.js';
import type { EngineResult, PipeXManifest, OperationOptions } from '../types.js';

export class BinaryController {
  readonly #engine: DataEngine;

  constructor(engine: DataEngine) {
    this.#engine = engine;
  }

  /**
   * Serialise any JS value to a msgpack Buffer (synchronous, zero-copy).
   * For streaming large datasets use engine.stream or engine.file.pack instead.
   */
  pack(data: unknown): Buffer {
    try {
      const packed = PACKR.pack(data) as Buffer;
      if (packed.length > this.#engine.limits.maxInputBytes) throw new Error('[PipeX] Packed input exceeds configured limit');
      return packed;
    } catch (err: unknown) {
      throw new Error(`[PipeX] binary.pack failed: ${(err as Error).message}`);
    }
  }

  /**
   * Deserialise a msgpack Buffer back to T (synchronous).
   */
  unpack<T = unknown>(input: Buffer | Uint8Array): T {
    try {
      if (input.byteLength > this.#engine.limits.maxInputBytes) throw new Error('[PipeX] Serialized input exceeds configured limit');
      return UNPACKR.unpack(input as Buffer) as T;
    } catch (err: unknown) {
      throw new Error(`[PipeX] binary.unpack failed: ${(err as Error).message}`);
    }
  }

  /**
   * Run input through the full plugin pipeline.
   * Returns an EngineResult that carries originalType so undo() can round-trip.
   */
  async run(input: unknown, options: OperationOptions = {}): Promise<EngineResult> {
    const signal = this.#engine.createOperationSignal(options);
    const requestId    = this.#engine.startRequest({ operation: 'run' });
    const startTime    = Date.now();
    const originalType = detectType(input);

    const span = this.#engine.tracer?.startSpan('binary:run', { requestId } as any);
    span?.setAttribute('input.type', originalType);

    // Core Input Validation
    try {
      this.#engine.validate(input);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      span?.setAttribute('error', true);
      span?.end();
      throw err;
    }

    let data: Buffer;
    try {
      data = toBuffer(input);
      if (data.length > this.#engine.limits.maxInputBytes) throw new Error('[PipeX] Input exceeds configured limit');
    } catch (error) {
      this.#engine.emitError(error, requestId);
      throw error;
    }
    const metrics: Record<string, number> = {};

    try {
      for (const plugin of this.#engine.plugins) {
        const t0  = Date.now();
        const pSpan = this.#engine.tracer?.startSpan(`plugin:${plugin.name}`, { requestId } as any);
        pSpan?.setAttribute('mode', 'process');
        
        try {
          const ctx = makeContext(requestId, { originalType }, this.#engine.logger, pSpan, signal);
          data = await withRetry(() => plugin.process(data, ctx), plugin.retryOptions, this.#engine.logger, { signal, limits: this.#engine.limits });
          if (data.length > this.#engine.limits.maxOutputBytes) throw new Error(`[PipeX] Plugin output exceeds configured limit`);
        } catch (e) {
          pSpan?.setAttribute('error', true);
          throw e;
        } finally {
          pSpan?.end();
        }

        const dur = Date.now() - t0;
        metrics[plugin.name] = dur;
        this.#engine.emit('plugin:after', plugin.name, dur);
      }
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      span?.setAttribute('error', true);
      span?.end();
      throw err;
    }

    const durationMs = Date.now() - startTime;
    this.#engine.endRequest(requestId, durationMs);
    span?.setAttribute('duration_ms', durationMs);
    span?.end();

    await this.#engine.emitAudit({
      requestId,
      operation: 'process',
      metadata: { inputType: originalType, durationMs },
    });

    return {
      data,
      originalType,
      pipeline: this.#engine.plugins.map(p => `${p.name}@${p.version}`),
      metrics:  { durationMs, steps: metrics },
    };
  }

  /**
   * Reverse the plugin pipeline for a previously processed EngineResult.
   *
   * Self-healing: if the result carries a manifest (written by file.pack),
   * the plugin chain is read from it — no manual forceType needed.
   *
   * Overload 1: undo(result)               — uses result.originalType
   * Overload 2: undo(buffer, forceType)    — for externally produced buffers
   */
  async undo<T = unknown>(result: EngineResult, options?: OperationOptions): Promise<T>;
  async undo<T = unknown>(input: Buffer, forceType: string, options?: OperationOptions): Promise<T>;
  async undo<T = unknown>(
    inputOrResult: Buffer | EngineResult,
    forceTypeOrOptions?: string | OperationOptions,
    operationOptions: OperationOptions = {},
  ): Promise<T> {
    const isResult   = !Buffer.isBuffer(inputOrResult);
    if (!isResult && (typeof forceTypeOrOptions !== 'string' || forceTypeOrOptions.length === 0)) {
      throw new Error('[PipeX] binary.undo(buffer, forceType) requires a non-empty forceType');
    }
    let   data       = isResult ? (inputOrResult as EngineResult).data : (inputOrResult as Buffer);
    const origType   = isResult
      ? (inputOrResult as EngineResult).originalType
      : (forceTypeOrOptions as string);
    const options = isResult && typeof forceTypeOrOptions === 'object'
      ? forceTypeOrOptions
      : operationOptions;
    const signal = this.#engine.createOperationSignal(options);
    const plugins = this.#engine.plugins;
    assertReversiblePipeline(plugins);

    const requestId  = this.#engine.startRequest({ operation: 'undo', originalType: origType });
    const span = this.#engine.tracer?.startSpan('binary:undo', { requestId } as any);

    if (data.length > this.#engine.limits.maxInputBytes) {
      const error = new Error('[PipeX] Undo input exceeds configured limit');
      this.#engine.emitError(error, requestId);
      span?.setAttribute('error', true);
      span?.end();
      throw error;
    }

    // If it looks like a manifest-prepended buffer, extract it for validation
    if (Buffer.isBuffer(inputOrResult) && inputOrResult.length > 0) {
      let manifest: PipeXManifest | undefined;
      try {
        const parsed = this.unpackWithManifest(inputOrResult);
        manifest = parsed.manifest;
        const actualData = parsed.data;
        data = actualData as Buffer;
      } catch {
        // Not a manifest buffer, continue with raw input
      }
      if (manifest) {
        const currentPipeline = this.#engine.plugins.map(p => `${p.name}@${p.version}`);
        if (JSON.stringify(currentPipeline) !== JSON.stringify(manifest.plugins)) {
          const error = new Error('[PipeX] Manifest plugin chain does not match the configured engine');
          this.#engine.emitError(error, requestId);
          span?.setAttribute('error', true);
          span?.end();
          throw error;
        }
      }
    }

    try {
      signal.throwIfAborted();
      for (const plugin of [...plugins].reverse()) {
        
        const pSpan = this.#engine.tracer?.startSpan(`plugin:${plugin.name}`, { requestId } as any);
        pSpan?.setAttribute('mode', 'reverse');
        
        try {
          const ctx = makeContext(requestId, { originalType: origType }, this.#engine.logger, pSpan, signal);
          data = await withRetry(
            () => plugin.reverse!(data, ctx),
            plugin.retryOptions,
            this.#engine.logger,
            { signal, limits: this.#engine.limits },
          );
          if (data.length > this.#engine.limits.maxOutputBytes) throw new Error('[PipeX] Plugin output exceeds configured limit');
        } catch (e) {
          pSpan?.setAttribute('error', true);
          throw e;
        } finally {
          pSpan?.end();
        }
        
        this.#engine.emit('plugin:after', plugin.name, 0);
      }
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      span?.setAttribute('error', true);
      span?.end();
      throw err;
    }

    let restored: T;
    try {
      restored = fromBuffer(data, origType) as T;
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      span?.setAttribute('error', true);
      span?.end();
      throw err;
    }

    // Core Output Validation
    try {
      this.#engine.validate(restored);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      span?.setAttribute('error', true);
      span?.end();
      throw err;
    }

    this.#engine.endRequest(requestId);
    span?.end();

    await this.#engine.emitAudit({
      requestId,
      operation: 'reverse',
      metadata: { originalType: origType },
    });
    
    return restored;
  }

  /**
   * Pack data AND embed a manifest header as the first msgpack frame.
   * Mirrors what file.pack writes to disk — useful for in-memory transport.
   */
  packWithManifest(data: unknown): Buffer {
    if (this.#engine.plugins.length > 0) {
      throw new Error('[PipeX] packWithManifest is serialization-only; use binary.run for plugin transforms');
    }
    const manifest = buildManifest([]);
    const mFrame   = PACKR.pack(manifest);
    const dFrame   = PACKR.pack(data);
    if (mFrame.length + dFrame.length > this.#engine.limits.maxInputBytes) {
      throw new Error('[PipeX] Serialized input exceeds configured limit');
    }
    return Buffer.concat([mFrame, dFrame]);
  }

  /**
   * Unpack a buffer that begins with a PipeXManifest frame.
   * Returns { manifest, data } — callers can inspect the manifest to verify
   * the pipeline that produced the buffer before consuming data.
   */
  unpackWithManifest<T = unknown>(input: Buffer): { manifest: PipeXManifest; data: T } {
    if (input.length > this.#engine.limits.maxInputBytes) throw new Error('[PipeX] Serialized input exceeds configured limit');
    const frames: unknown[] = [];
    try {
      UNPACKR.unpackMultiple(input, (value) => {
        if (frames.length >= this.#engine.limits.maxFrames) throw new Error('[PipeX] Frame count exceeds configured limit');
        frames.push(value);
      });
    } catch (err: unknown) {
      throw new Error(`[PipeX] binary.unpackWithManifest: failed to decode frames — ${(err as Error).message}`);
    }

    if (frames.length < 2) {
      throw new Error('[PipeX] binary.unpackWithManifest: buffer contains fewer than 2 frames');
    }
    if (!isManifest(frames[0])) {
      throw new Error('[PipeX] binary.unpackWithManifest: first frame is not a PipeXManifest');
    }
    return { manifest: frames[0], data: frames[1] as T };
  }
}
