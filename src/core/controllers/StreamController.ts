/**
 * StreamController — live stream operations
 *
 * engine.stream.into(writable)        → Writable endpoint (compress forward)
 * engine.stream.reverseInto(writable) → Writable endpoint (decompress reversed)
 * engine.stream.pack()                → PackrStream  (object → msgpack bytes)
 * engine.stream.unpack()              → GuardedUnpackrStream (bytes → objects)
 * engine.stream.pipe(readable, writable) → orchestrate full pipeline
 */

import { Readable, Writable, Transform, PassThrough } from 'node:stream';
import type { DataEngine }                             from '../dataEngine.js';
import {
  buildTransformChain,
  buildManifest,
  buildManifestHeaderTransform,
  buildManifestExtractTransform,
  createPackrStream,
  createUnpackrStream,
  runPipeline,
} from '../core.js';
import type { PipeXManifest }  from '../types.js';


export class StreamController {
  readonly #engine: DataEngine;

  constructor(engine: DataEngine) {
    this.#engine = engine;
  }

  /**
   * Returns a Writable that pumps incoming bytes through the plugin pipeline
   * (compress direction) and forwards them to `destination`.
   *
   * @example
   * readableSource.pipe(engine.stream.into(createWriteStream('out')));
   */
  into(destination: Writable): Writable {
    const requestId  = this.#engine.startRequest();
    const transforms = buildTransformChain(
      this.#engine.plugins, 'compress', false,
      bytes => this.#engine.emitProgress(bytes, requestId),
      this.#engine.logger,
      this.#engine.tracer,
      this.#engine.dlq,
    );
    const entry = new PassThrough();
    runPipeline(entry, transforms, destination)
      .then(() => this.#engine.endRequest(requestId))
      .catch(err => {
        this.#engine.emitError(err, requestId);
        entry.destroy(err instanceof Error ? err : new Error(String(err)));
      });
    return entry;
  }

  /**
   * Returns a Writable that pumps bytes through the reversed plugin pipeline
   * (decompress direction) and forwards to `destination`.
   *
   * @example
   * readableSource.pipe(engine.stream.reverseInto(createWriteStream('restored')));
   */
  reverseInto(destination: Writable): Writable {
    const requestId  = this.#engine.startRequest();
    const transforms = buildTransformChain(
      this.#engine.plugins, 'decompress', true,
      bytes => this.#engine.emitProgress(bytes, requestId),
      this.#engine.logger,
      this.#engine.tracer,
      this.#engine.dlq,
    );
    const entry = new PassThrough();
    runPipeline(entry, transforms, destination)
      .then(() => this.#engine.endRequest(requestId))
      .catch(err => {
        this.#engine.emitError(err, requestId);
        entry.destroy(err instanceof Error ? err : new Error(String(err)));
      });
    return entry;
  }

  /**
   * Returns a PackrStream: write JS objects, read msgpack bytes.
   * A manifest header frame is prepended automatically.
   *
   * @example
   * objectSource.pipe(engine.stream.pack()).pipe(tcpSocket);
   */
  pack(): Transform {
    const packer = createPackrStream();
    const header = buildManifestHeaderTransform(buildManifest(this.#engine.plugins));
    packer.pipe(header);
    // Expose `header` as the readable end — callers pipe from this Transform
    return header;
  }

  /**
   * Returns a GuardedUnpackrStream: write msgpack bytes, read JS objects.
   * Fires the engine's 'manifest' event when the header frame is detected.
   *
   * @example
   * tcpSocket.pipe(engine.stream.unpack()).on('data', obj => console.log(obj));
   */
  unpack(): Transform {
    const unpacker = createUnpackrStream();
    const extract  = buildManifestExtractTransform((m: PipeXManifest) => {
      this.#engine.emit('manifest', m);
    });
    unpacker.pipe(extract);
    return extract;
  }

  /**
   * Orchestrate a complete pipeline: Readable → plugin chain → Writable.
   * This is the primary low-level entry point — file/binary controllers
   * build on top of this.
   *
   * @example
   * await engine.stream.pipe(
   *   createReadStream('input.bin'),
   *   createWriteStream('output.bin'),
   * );
   */
  async pipe(source: Readable, destination: Writable, reverse = false): Promise<void> {
    const requestId  = this.#engine.startRequest();
    const mode       = reverse ? 'decompress' : 'compress';
    const transforms = buildTransformChain(
      this.#engine.plugins, mode, reverse,
      bytes => this.#engine.emitProgress(bytes, requestId),
      this.#engine.logger,
      this.#engine.tracer,
      this.#engine.dlq,
    );
    try {
      await runPipeline(source, transforms, destination);
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }
}