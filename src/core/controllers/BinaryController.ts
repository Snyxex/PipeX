/**
 * BinaryController — in-memory binary operations
 *
 * engine.binary.pack(data)     → Buffer (msgpack)
 * engine.binary.unpack(buf)    → T
 * engine.binary.run(input)     → EngineResult  (plugin pipeline)
 * engine.binary.undo(result)   → T             (trusted-type round-trip)
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
  assertMessagePackFrameLimits,
  assertKnownValueByteLimit,
  assertOriginalType,
} from '../core.js';
import type { EngineResult, PipeXManifest, OperationOptions, BinaryUndoOptions } from '../types.js';

import { awaitOperation, throwIfAborted } from '../operations.js';

export class BinaryController {
  readonly #engine: DataEngine;

  constructor(engine: DataEngine) {
    this.#engine = engine;
  }

  /**
   * Serialise a supported JS value to a msgpack Buffer (synchronous).
   * For streaming large datasets use engine.stream or engine.file.pack instead.
   */
  pack(data: unknown): Buffer {
    try {
      assertKnownValueByteLimit(
        data,
        Math.min(this.#engine.limits.maxInputBytes, this.#engine.limits.maxFrameBytes),
        'Serialization input',
      );
      const packed = PACKR.pack(data) as Buffer;
      if (packed.length > this.#engine.limits.maxInputBytes) throw new Error('[PipeX] Packed input exceeds configured limit');
      assertMessagePackFrameLimits(packed, this.#engine.limits.maxFrameBytes, 1);
      if (packed.length > this.#engine.limits.maxOutputBytes) throw new Error('[PipeX] Packed output exceeds configured limit');
      return packed;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('[PipeX]')) throw err;
      throw new Error('[PipeX] binary.pack failed');
    }
  }

  /**
   * Deserialise a msgpack Buffer back to T (synchronous).
   */
  unpack<T = unknown>(input: Buffer | Uint8Array): T {
    try {
      if (input.byteLength > this.#engine.limits.maxInputBytes) throw new Error('[PipeX] Serialized input exceeds configured limit');
      assertMessagePackFrameLimits(input, this.#engine.limits.maxFrameBytes, 1);
      return UNPACKR.unpack(input as Buffer) as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('[PipeX]')) throw err;
      throw new Error('[PipeX] binary.unpack failed: invalid MessagePack input');
    }
  }

  // Only locally produced buffers carry a trusted implicit type. Transported
  // results must be decoded using an application-owned expectedType.
  readonly #trustedTypes = new WeakMap<Buffer, string>();

  async run(input: unknown, options: OperationOptions = {}): Promise<EngineResult> {
    const signal = this.#engine.createOperationSignal(options);
    throwIfAborted(signal);
    const originalType = detectType(input);
    assertOriginalType(originalType);
    const plugins = this.#engine.plugins;
    const pipeline = [...this.#engine.pipeline];
    const limits = this.#engine.limits;
    const requestId = this.#engine.startRequest({ operation: 'run' });
    const startTime = Date.now();
    const span = this.#engine.tracer?.startSpan('binary:run', { requestId } as any);
    try {
      span?.setAttribute('input.type', originalType);
      this.#engine.validate(input);
      assertKnownValueByteLimit(input, limits.maxInputBytes, 'Input');
      let data = toBuffer(input);
      if (data.length > limits.maxInputBytes) throw new Error('[PipeX] Input exceeds configured limit');
      if (originalType === 'object' || originalType === 'array') {
        assertMessagePackFrameLimits(data, limits.maxFrameBytes, 1);
      }
      const metrics: Record<string, number> = Object.create(null);
      for (const plugin of plugins) {
        const t0 = Date.now();
        const pSpan = this.#engine.tracer?.startSpan(`plugin:${plugin.name}`, { requestId } as any);
        try {
          pSpan?.setAttribute('mode', 'process');
          const ctx = makeContext(requestId, { originalType }, this.#engine.logger, pSpan, signal, limits);
          data = await withRetry(() => plugin.process(data, ctx), plugin.retryOptions, this.#engine.logger, {
            signal, limits, track: pending => this.#engine.trackWork(requestId, pending),
          });
          if (!Buffer.isBuffer(data) || data.length > limits.maxOutputBytes) throw new Error('[PipeX] Plugin output exceeds configured limit');
        } catch (error) {
          pSpan?.setAttribute('error', true);
          throw error;
        } finally { pSpan?.end(); }
        metrics[plugin.name] = Date.now() - t0;
        this.#engine.emit('plugin:after', plugin.name, metrics[plugin.name]!);
      }
      if (data.length > limits.maxOutputBytes) throw new Error('[PipeX] Output exceeds configured limit');
      throwIfAborted(signal);
      const durationMs = Date.now() - startTime;
      await awaitOperation(this.#engine.emitAudit({
        requestId, operation: 'process', metadata: { inputType: originalType, durationMs },
      }), signal, pending => this.#engine.trackWork(requestId, pending));
      throwIfAborted(signal);
      this.#trustedTypes.set(data, originalType);
      const result: EngineResult = { data, originalType, pipeline, metrics: { durationMs, steps: metrics } };
      span?.setAttribute('duration_ms', durationMs);
      this.#engine.endRequest(requestId, durationMs);
      return result;
    } catch (error) {
      span?.setAttribute('error', true);
      this.#engine.emitError(error, requestId);
      throw error;
    } finally {
      span?.end();
      this.#engine.releaseRequest(requestId);
    }
  }

  async undo<T = unknown>(result: EngineResult, options?: BinaryUndoOptions): Promise<T>;
  async undo<T = unknown>(input: Buffer, forceType: string, options?: OperationOptions): Promise<T>;
  async undo<T = unknown>(
    inputOrResult: Buffer | EngineResult,
    forceTypeOrOptions?: string | BinaryUndoOptions,
    operationOptions: OperationOptions = {},
  ): Promise<T> {
    const raw = Buffer.isBuffer(inputOrResult);
    let data: Buffer;
    let origType: string;
    let options: OperationOptions;
    if (raw) {
      assertOriginalType(forceTypeOrOptions);
      data = inputOrResult;
      origType = forceTypeOrOptions;
      options = operationOptions;
    } else {
      const result = inputOrResult;
      if (!result || typeof result !== 'object' || !Buffer.isBuffer(result.data)
        || !Array.isArray(result.pipeline) || result.pipeline.length > 256
        || !result.pipeline.every(p => typeof p === 'string' && p.length <= 512)
        || !result.metrics || !Number.isFinite(result.metrics.durationMs) || result.metrics.durationMs < 0
        || !result.metrics.steps || typeof result.metrics.steps !== 'object' || Array.isArray(result.metrics.steps)
        || !Object.values(result.metrics.steps).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
        throw new Error('[PipeX] Invalid EngineResult');
      }
      assertOriginalType(result.originalType);
      if (forceTypeOrOptions !== undefined && (forceTypeOrOptions === null || typeof forceTypeOrOptions !== 'object')) {
        throw new Error('[PipeX] Invalid undo options');
      }
      const undoOptions = forceTypeOrOptions as BinaryUndoOptions | undefined;
      const trustedType = undoOptions?.expectedType ?? this.#trustedTypes.get(result.data);
      if (trustedType === undefined) throw new Error('[PipeX] Transported EngineResult requires a trusted expectedType');
      assertOriginalType(trustedType);
      if (trustedType !== result.originalType) throw new Error('[PipeX] Result type does not match the expected type');
      data = result.data;
      origType = trustedType;
      options = undoOptions ?? {};
    }
    const signal = this.#engine.createOperationSignal(options);
    throwIfAborted(signal);
    const plugins = this.#engine.plugins;
    assertReversiblePipeline(plugins);
    const limits = this.#engine.limits;
    if (data.length > limits.maxInputBytes) throw new Error('[PipeX] Undo input exceeds configured limit');
    const requestId = this.#engine.startRequest({ operation: 'undo', originalType: origType });
    const span = this.#engine.tracer?.startSpan('binary:undo', { requestId } as any);
    try {
      // Serialization manifests are never parsed ahead of cryptographic checks.
      if (raw && plugins.length === 0 && data.length > 0) {
        let parsed: { manifest: PipeXManifest; data: unknown } | undefined;
        try { parsed = this.unpackWithManifest(data); } catch { /* raw input */ }
        if (parsed) {
          if (parsed.manifest.plugins.length !== 0) throw new Error('[PipeX] Manifest plugin chain does not match the configured engine');
          if (detectType(parsed.data) !== origType) throw new Error('[PipeX] Manifest data does not match the expected type');
          data = toBuffer(parsed.data);
        }
      }
      for (const plugin of [...plugins].reverse()) {
        const pSpan = this.#engine.tracer?.startSpan(`plugin:${plugin.name}`, { requestId } as any);
        try {
          pSpan?.setAttribute('mode', 'reverse');
          const ctx = makeContext(requestId, { originalType: origType }, this.#engine.logger, pSpan, signal, limits);
          data = await withRetry(() => plugin.reverse!(data, ctx), plugin.retryOptions, this.#engine.logger, {
            signal, limits, track: pending => this.#engine.trackWork(requestId, pending),
          });
          if (!Buffer.isBuffer(data) || data.length > limits.maxOutputBytes) throw new Error('[PipeX] Plugin output exceeds configured limit');
        } catch (error) {
          pSpan?.setAttribute('error', true);
          throw error;
        } finally { pSpan?.end(); }
        this.#engine.emit('plugin:after', plugin.name, 0);
      }
      if (data.length > limits.maxOutputBytes) throw new Error('[PipeX] Output exceeds configured limit');
      throwIfAborted(signal);
      const restored = fromBuffer(data, origType, limits.maxFrameBytes) as T;
      this.#engine.validate(restored);
      throwIfAborted(signal);
      await awaitOperation(this.#engine.emitAudit({
        requestId, operation: 'reverse', metadata: { originalType: origType },
      }), signal, pending => this.#engine.trackWork(requestId, pending));
      throwIfAborted(signal);
      this.#engine.endRequest(requestId);
      return restored;
    } catch (error) {
      span?.setAttribute('error', true);
      this.#engine.emitError(error, requestId);
      throw error;
    } finally {
      span?.end();
      this.#engine.releaseRequest(requestId);
    }
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
    assertKnownValueByteLimit(
      data,
      Math.min(this.#engine.limits.maxInputBytes, this.#engine.limits.maxFrameBytes),
      'Serialization input',
    );
    const mFrame   = PACKR.pack(manifest);
    const dFrame   = PACKR.pack(data);
    assertMessagePackFrameLimits(mFrame, this.#engine.limits.maxFrameBytes, 1);
    assertMessagePackFrameLimits(dFrame, this.#engine.limits.maxFrameBytes, 1);
    if (mFrame.length + dFrame.length > Math.min(this.#engine.limits.maxInputBytes, this.#engine.limits.maxOutputBytes)) {
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
    assertMessagePackFrameLimits(
      input,
      this.#engine.limits.maxFrameBytes,
      2,
    );
    const frames: unknown[] = [];
    try {
      UNPACKR.unpackMultiple(input, (value) => {
        if (frames.length >= 2) throw new Error('[PipeX] Frame count exceeds configured limit');
        frames.push(value);
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('[PipeX]')) throw err;
      throw new Error('[PipeX] binary.unpackWithManifest: invalid MessagePack input');
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
