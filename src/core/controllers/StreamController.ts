/**
 * StreamController — live stream operations
 *
 * engine.stream.into(writable)        → Writable endpoint (compress forward)
 * engine.stream.reverseInto(writable) → Writable endpoint (decompress reversed)
 * engine.stream.pack()                → PackrStream  (object → msgpack bytes)
 * engine.stream.unpack()              → GuardedUnpackrStream (bytes → objects)
 * engine.stream.pipe(readable, writable) → orchestrate full pipeline
 */

import { Readable, Writable, Transform, PassThrough, Duplex } from 'node:stream';
import type { DataEngine }                             from '../dataEngine.js';
import {
  buildTransformChain,
  buildManifest,
  buildManifestHeaderTransform,
  buildManifestExtractTransform,
  createPackrStream,
  createUnpackrStream,
  runPipeline,
  buildByteLimitTransform,
  buildObjectLimitTransform,
} from '../core.js';
import type { OperationOptions, PipeXManifest, StreamPluginContext }  from '../types.js';


export class StreamController {
  readonly #engine: DataEngine;

  constructor(engine: DataEngine) {
    this.#engine = engine;
  }

  #streamContext(requestId: string, signal: AbortSignal): StreamPluginContext {
    return { requestId, signal, limits: this.#engine.limits, logger: this.#engine.logger, tracer: this.#engine.tracer };
  }

  #bridge(input: PassThrough, output: PassThrough, objectMode: boolean): Duplex {
    const duplex = new Duplex({
      writableObjectMode: objectMode,
      readableObjectMode: objectMode,
      write(chunk, encoding, callback) {
        input.write(chunk, encoding as BufferEncoding, callback);
      },
      final(callback) {
        output.once('end', callback);
        input.end();
      },
      read() { /* output events push data below */ },
    });
    output.on('data', chunk => duplex.push(chunk));
    output.once('end', () => duplex.push(null));
    output.once('error', error => duplex.destroy(error));
    input.once('error', error => duplex.destroy(error));
    return duplex;
  }

  /**
   * Returns a Writable that pumps incoming bytes through the plugin pipeline
   * (compress direction) and forwards them to `destination`.
   *
   * @example
   * readableSource.pipe(engine.stream.into(createWriteStream('out')));
   */
  into(destination: Writable, options: OperationOptions = {}): Writable {
    const signal = this.#engine.createOperationSignal(options);
    if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw byte streams');
    const requestId  = this.#engine.startRequest();
    const context = this.#streamContext(requestId, signal);
    const transforms = buildTransformChain(
      this.#engine.plugins, 'compress', false,
      bytes => this.#engine.emitProgress(bytes, requestId),
      this.#engine.logger,
      this.#engine.tracer,
      this.#engine.dlq,
      context,
    );
    const entry = new PassThrough();
    runPipeline(entry, [buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'), ...transforms, buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output')], destination, { signal })
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
  reverseInto(destination: Writable, options: OperationOptions = {}): Writable {
    const signal = this.#engine.createOperationSignal(options);
    if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw byte streams');
    const requestId  = this.#engine.startRequest();
    const context = this.#streamContext(requestId, signal);
    const transforms = buildTransformChain(
      this.#engine.plugins, 'decompress', true,
      bytes => this.#engine.emitProgress(bytes, requestId),
      this.#engine.logger,
      this.#engine.tracer,
      this.#engine.dlq,
      context,
    );
    const entry = new PassThrough();
    runPipeline(entry, [buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'), ...transforms, buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output')], destination, { signal })
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
  pack(options: OperationOptions = {}): Duplex {
    const requestId = this.#engine.startRequest({ operation: 'pack' });
    const signal = this.#engine.createOperationSignal(options);
    const input = new PassThrough({ objectMode: true });
    const output = new PassThrough();
    const transforms = [
      buildObjectLimitTransform(this.#engine.limits.maxFrames),
      createPackrStream(),
      buildManifestHeaderTransform(buildManifest([])),
      buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
    ];
    const duplex = this.#bridge(input, output, true);
    runPipeline(input, transforms, output, { signal })
      .then(() => this.#engine.endRequest(requestId))
      .catch(error => {
        this.#engine.emitError(error, requestId);
        duplex.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    // Expose `header` as the readable end — callers pipe from this Transform
    return duplex;
  }

  /**
   * Returns a GuardedUnpackrStream: write msgpack bytes, read JS objects.
   * Fires the engine's 'manifest' event when the header frame is detected.
   *
   * @example
   * tcpSocket.pipe(engine.stream.unpack()).on('data', obj => console.log(obj));
   */
  unpack(options: OperationOptions = {}): Duplex {
    const requestId = this.#engine.startRequest({ operation: 'unpack' });
    const signal = this.#engine.createOperationSignal(options);
    const input = new PassThrough();
    const output = new PassThrough({ objectMode: true });
    const unpacker = createUnpackrStream(this.#engine.limits.maxInputBytes);
    const extract  = buildManifestExtractTransform((m: PipeXManifest) => {
      const expected: string[] = [];
      if (m.plugins.length !== expected.length || m.plugins.some((plugin, index) => plugin !== expected[index])) {
        throw new Error('[PipeX] Manifest plugin chain does not match the configured engine');
      }
      this.#engine.emit('manifest', m, requestId);
    });
    const validate = new Transform({
      writableObjectMode: true,
      readableObjectMode: true,
      transform: (value: unknown, _encoding, callback) => {
        try { this.#engine.validate(value); callback(null, value); }
        catch (error) { callback(error as Error); }
      },
    });
    const transforms = [
      buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
      unpacker,
      buildObjectLimitTransform(this.#engine.limits.maxFrames),
      extract,
      validate,
    ];
    const duplex = this.#bridge(input, output, true);
    runPipeline(input, transforms, output, { signal })
      .then(() => this.#engine.endRequest(requestId))
      .catch(error => {
        this.#engine.emitError(error, requestId);
        duplex.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    return duplex;
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
  async pipe(source: Readable, destination: Writable, reverse = false, options: OperationOptions = {}): Promise<void> {
    const signal = this.#engine.createOperationSignal(options);
    if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw byte streams');
    const requestId  = this.#engine.startRequest();
    const mode       = reverse ? 'decompress' : 'compress';
    const context = this.#streamContext(requestId, signal);
    const transforms = buildTransformChain(
      this.#engine.plugins, mode, reverse,
      bytes => this.#engine.emitProgress(bytes, requestId),
      this.#engine.logger,
      this.#engine.tracer,
      this.#engine.dlq,
      context,
    );
    try {
      await runPipeline(source, [
        buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
        ...transforms,
        buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
      ], destination, { signal });
      this.#engine.endRequest(requestId);
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }
}
