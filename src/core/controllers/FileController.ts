/**
 * FileController — file-to-file operations
 *
 * engine.file.process(input, output)
 * engine.file.reverse(input, output)
 * engine.file.pack(input, output)     → write msgpack + manifest header
 * engine.file.unpack(input, output)   → read msgpack, write NDJSON
 */

import { createReadStream, createWriteStream } from 'node:fs';
import type { DataEngine }                     from '../dataEngine.js';
import {
  assertExists,
  buildManifest,
  buildManifestHeaderTransform,
  buildManifestExtractTransform,
  buildNdjsonTransform,
  buildTransformChain,
  createPackrStream,
  createUnpackrStream,
  runPipeline,
  DEFAULT_HIGH_WATER,
} from '../core.js';
import type { PipeXManifest } from '../types.js';

export class FileController {
  readonly #engine: DataEngine;

  constructor(engine: DataEngine) {
    this.#engine = engine;
  }

  /**
   * Source file → Plugin pipeline (compress) → Destination file.
   */
  async process(inputPath: string, outputPath: string, allowedRoot?: string): Promise<void> {
    const requestId = this.#engine.startRequest();
    try {
      const src       = createReadStream(assertExists(inputPath, allowedRoot), { highWaterMark: DEFAULT_HIGH_WATER });
      const dst       = createWriteStream(outputPath);
      const transforms = buildTransformChain(
        this.#engine.plugins, 'compress', false,
        bytes => this.#engine.emitProgress(bytes, requestId),
        this.#engine.logger,
        this.#engine.tracer,
        this.#engine.dlq,
      );
      await runPipeline(src, transforms, dst);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }

  /**
   * Source file → Plugin pipeline (decompress, reversed) → Destination file.
   */
  async reverse(inputPath: string, outputPath: string, allowedRoot?: string): Promise<void> {
    const requestId = this.#engine.startRequest();
    try {
      const src        = createReadStream(assertExists(inputPath, allowedRoot), { highWaterMark: DEFAULT_HIGH_WATER });
      const dst        = createWriteStream(outputPath);
      const transforms = buildTransformChain(
        this.#engine.plugins, 'decompress', true,
        bytes => this.#engine.emitProgress(bytes, requestId),
        this.#engine.logger,
        this.#engine.tracer,
        this.#engine.dlq,
      );
      await runPipeline(src, transforms, dst);
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
  async pack(inputPath: string, outputPath: string, allowedRoot?: string): Promise<void> {
    const requestId = this.#engine.startRequest();
    try {
      const src      = createReadStream(assertExists(inputPath, allowedRoot), { highWaterMark: DEFAULT_HIGH_WATER });
      const dst      = createWriteStream(outputPath);
      const packer   = createPackrStream();
      const header   = buildManifestHeaderTransform(buildManifest(this.#engine.plugins));
      await runPipeline(src, [packer, header], dst);
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
  async unpack(inputPath: string, outputPath: string, allowedRoot?: string): Promise<void> {
    const requestId = this.#engine.startRequest();
    try {
      const src      = createReadStream(assertExists(inputPath, allowedRoot), { highWaterMark: DEFAULT_HIGH_WATER });
      const dst      = createWriteStream(outputPath);
      const unpacker = createUnpackrStream();
      const extract  = buildManifestExtractTransform((m: PipeXManifest) => {
        this.#engine.emit('manifest', m, requestId);
      });
      const ndjson = buildNdjsonTransform();
      await runPipeline(src, [unpacker, extract, ndjson], dst);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }
}