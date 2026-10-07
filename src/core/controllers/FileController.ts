/**
 * FileController — file-to-file operations
 *
 * engine.file.process(input, output)
 * engine.file.reverse(input, output)
 * engine.file.pack(input, output)     → write msgpack + manifest header
 * engine.file.unpack(input, output)   → read msgpack, write NDJSON
 */

import { Transform, type Readable, type Writable } from 'node:stream';
import { openAtomicFileSession } from '../secureFiles.js';
import { awaitOperation, throwIfAborted } from '../operations.js';
import type { DataEngine }                     from '../dataEngine.js';
import {
  buildManifest,
  buildManifestHeaderTransform,
  buildManifestExtractTransform,
  buildNdjsonTransform,
  buildTransformChain,
  createPackrStream,
  createUnpackrStream,
  runPipeline,
  buildByteLimitTransform,
  buildFrameLimitTransform,
  buildObjectLimitTransform,
  buildKnownValueByteLimitTransform,
} from '../core.js';
import type { OperationOptions, PipeXManifest, StreamPluginContext } from '../types.js';

export class FileController {
  readonly #engine: DataEngine;

  constructor(engine: DataEngine) {
    this.#engine = engine;
  }

  async #withAtomicOutput(
    inputPath: string,
    outputPath: string,
    allowedRoot: string | undefined,
    signal: AbortSignal,
    run: (source: Readable, destination: Writable) => Promise<void>,
  ): Promise<void> {
    const session = openAtomicFileSession(inputPath, outputPath, allowedRoot);
    try {
      await run(session.source, session.destination);
      throwIfAborted(signal);
      session.commit();
    } finally { await session.dispose(); }
  }

  #streamContext(requestId: string, signal: AbortSignal): StreamPluginContext {
    return { requestId, signal, track: pending => this.#engine.trackWork(requestId, pending), limits: this.#engine.limits, logger: this.#engine.logger, tracer: this.#engine.tracer };
  }

  /**
   * Source file → Plugin pipeline (compress) → Destination file.
   */
  async process(inputPath: string, outputPath: string, allowedRoot?: string, options: OperationOptions = {}): Promise<void> {
    const signal = this.#engine.createOperationSignal(options);
    throwIfAborted(signal);
    const requestId = this.#engine.startRequest();
    try {
      if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw file streams');
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, signal, async (src, dst) => {
        const context = this.#streamContext(requestId, signal);
        const transforms = [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          ...buildTransformChain(this.#engine.plugins, 'compress', false, bytes => this.#engine.emitProgress(bytes, requestId), this.#engine.logger, this.#engine.tracer, this.#engine.dlq, context),
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ];
        await runPipeline(src, transforms, dst, { signal });
      });
      await awaitOperation(this.#engine.emitAudit({ requestId, operation: 'process', metadata: { controller: 'file' } }), signal, pending => this.#engine.trackWork(requestId, pending));
      throwIfAborted(signal);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }

  /**
   * Source file → Plugin pipeline (decompress, reversed) → Destination file.
   */
  async reverse(inputPath: string, outputPath: string, allowedRoot?: string, options: OperationOptions = {}): Promise<void> {
    const signal = this.#engine.createOperationSignal(options);
    throwIfAborted(signal);
    const requestId = this.#engine.startRequest();
    try {
      if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw file streams');
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, signal, async (src, dst) => {
        const context = this.#streamContext(requestId, signal);
        const transforms = [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          ...buildTransformChain(this.#engine.plugins, 'decompress', true, bytes => this.#engine.emitProgress(bytes, requestId), this.#engine.logger, this.#engine.tracer, this.#engine.dlq, context),
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ];
        await runPipeline(src, transforms, dst, { signal });
      });
      await awaitOperation(this.#engine.emitAudit({ requestId, operation: 'reverse', metadata: { controller: 'file' } }), signal, pending => this.#engine.trackWork(requestId, pending));
      throwIfAborted(signal);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }

  /**
   * Source file → PackrStream → manifest header → Destination msgpack file.
   *
   * Output format: [ PipeXManifest frame ][ ...data frames ]
   * The serialization-only manifest declares an empty plugin chain.
   */
  async pack(inputPath: string, outputPath: string, allowedRoot?: string, options: OperationOptions = {}): Promise<void> {
    const signal = this.#engine.createOperationSignal(options);
    throwIfAborted(signal);
    const requestId = this.#engine.startRequest();
    try {
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, signal, async (src, dst) => {
        const transforms = [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          buildObjectLimitTransform(this.#engine.limits.maxFrames),
          buildKnownValueByteLimitTransform(this.#engine.limits.maxFrameBytes, 'MessagePack frame'),
          createPackrStream(),
          buildManifestHeaderTransform(buildManifest([])),
          buildFrameLimitTransform(
            this.#engine.limits.maxFrameBytes,
            Math.min(Number.MAX_SAFE_INTEGER, this.#engine.limits.maxFrames + 1),
          ),
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ];
        await runPipeline(src, transforms, dst, { signal });
      });
      await awaitOperation(this.#engine.emitAudit({ requestId, operation: 'pack', metadata: { controller: 'file' } }), signal, pending => this.#engine.trackWork(requestId, pending));
      throwIfAborted(signal);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }

  /**
   * Source msgpack file → UnpackrStream → manifest extraction → NDJSON → Destination file.
   *
   * Fires 'manifest' event with the recovered PipeXManifest before streaming data.
   */
  async unpack(inputPath: string, outputPath: string, allowedRoot?: string, options: OperationOptions = {}): Promise<void> {
    const signal = this.#engine.createOperationSignal(options);
    throwIfAborted(signal);
    const requestId = this.#engine.startRequest();
    try {
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, signal, async (src, dst) => {
        const unpacker = createUnpackrStream(this.#engine.limits.maxInputBytes);
        const extract = buildManifestExtractTransform((manifest: PipeXManifest) => {
          const expected: string[] = [];
          if (manifest.plugins.length !== expected.length || manifest.plugins.some((plugin, index) => plugin !== expected[index])) {
            throw new Error('[PipeX] Manifest plugin chain does not match the configured engine');
          }
          this.#engine.emit('manifest', manifest, requestId);
        });
        const ndjson = buildNdjsonTransform();
        const validate = new Transform({
          writableObjectMode: true,
          readableObjectMode: true,
          transform: (value: unknown, _encoding, callback) => {
            try { this.#engine.validate(value); callback(null, value); }
            catch (error) { callback(error as Error); }
          },
        });
        await runPipeline(src, [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          buildFrameLimitTransform(
            this.#engine.limits.maxFrameBytes,
            Math.min(Number.MAX_SAFE_INTEGER, this.#engine.limits.maxFrames + 1),
          ),
          unpacker,
          extract,
          buildObjectLimitTransform(this.#engine.limits.maxFrames),
          validate,
          ndjson,
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ], dst, { signal });
      });
      await awaitOperation(this.#engine.emitAudit({ requestId, operation: 'unpack', metadata: { controller: 'file' } }), signal, pending => this.#engine.trackWork(requestId, pending));
      throwIfAborted(signal);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }
}
