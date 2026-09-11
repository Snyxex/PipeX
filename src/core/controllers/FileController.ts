/**
 * FileController — file-to-file operations
 *
 * engine.file.process(input, output)
 * engine.file.reverse(input, output)
 * engine.file.pack(input, output)     → write msgpack + manifest header
 * engine.file.unpack(input, output)   → read msgpack, write NDJSON
 */

import { createReadStream, createWriteStream, existsSync, realpathSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import type { DataEngine }                     from '../dataEngine.js';
import {
  assertExists,
  resolveOutputPath,
  buildManifest,
  buildManifestHeaderTransform,
  buildManifestExtractTransform,
  buildNdjsonTransform,
  buildTransformChain,
  createPackrStream,
  createUnpackrStream,
  runPipeline,
  DEFAULT_HIGH_WATER,
  buildByteLimitTransform,
  buildObjectLimitTransform,
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
    run: (input: string, temporaryOutput: string) => Promise<void>,
  ): Promise<void> {
    const input = assertExists(inputPath, allowedRoot);
    const output = resolveOutputPath(outputPath, allowedRoot);
    if (existsSync(output) && realpathSync.native(output) === input) {
      throw new Error('[PipeX] Input and output must be different files');
    }
    const temporary = `${output}.pipex-${randomUUID()}.tmp`;
    try {
      await run(input, temporary);
      await rename(temporary, output);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  #streamContext(requestId: string, signal: AbortSignal): StreamPluginContext {
    return { requestId, signal, limits: this.#engine.limits, logger: this.#engine.logger, tracer: this.#engine.tracer };
  }

  /**
   * Source file → Plugin pipeline (compress) → Destination file.
   */
  async process(inputPath: string, outputPath: string, allowedRoot?: string, options: OperationOptions = {}): Promise<void> {
    const requestId = this.#engine.startRequest();
    const signal = this.#engine.createOperationSignal(options);
    try {
      if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw file streams');
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, async (input, temporary) => {
        const src = createReadStream(input, { highWaterMark: DEFAULT_HIGH_WATER });
        const dst = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
        const context = this.#streamContext(requestId, signal);
        const transforms = [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          ...buildTransformChain(this.#engine.plugins, 'compress', false, bytes => this.#engine.emitProgress(bytes, requestId), this.#engine.logger, this.#engine.tracer, this.#engine.dlq, context),
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ];
        await runPipeline(src, transforms, dst, { signal });
      });
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
    const requestId = this.#engine.startRequest();
    const signal = this.#engine.createOperationSignal(options);
    try {
      if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw file streams');
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, async (input, temporary) => {
        const src = createReadStream(input, { highWaterMark: DEFAULT_HIGH_WATER });
        const dst = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
        const context = this.#streamContext(requestId, signal);
        const transforms = [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          ...buildTransformChain(this.#engine.plugins, 'decompress', true, bytes => this.#engine.emitProgress(bytes, requestId), this.#engine.logger, this.#engine.tracer, this.#engine.dlq, context),
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ];
        await runPipeline(src, transforms, dst, { signal });
      });
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
   * The manifest encodes the plugin chain so reverse() is self-healing.
   */
  async pack(inputPath: string, outputPath: string, allowedRoot?: string, options: OperationOptions = {}): Promise<void> {
    const requestId = this.#engine.startRequest();
    const signal = this.#engine.createOperationSignal(options);
    try {
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, async (input, temporary) => {
        const src = createReadStream(input, { highWaterMark: DEFAULT_HIGH_WATER });
        const dst = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
        const transforms = [
          buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
          createPackrStream(),
          buildManifestHeaderTransform(buildManifest([])),
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ];
        await runPipeline(src, transforms, dst, { signal });
      });
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
    const requestId = this.#engine.startRequest();
    const signal = this.#engine.createOperationSignal(options);
    try {
      await this.#withAtomicOutput(inputPath, outputPath, allowedRoot, async (input, temporary) => {
        const src = createReadStream(input, { highWaterMark: DEFAULT_HIGH_WATER });
        const dst = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
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
          unpacker,
          buildObjectLimitTransform(this.#engine.limits.maxFrames),
          extract,
          validate,
          ndjson,
          buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
        ], dst, { signal });
      });
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }
}
