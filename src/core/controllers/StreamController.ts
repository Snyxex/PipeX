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

  #bridge(input: PassThrough, output: PassThrough): Duplex {
    // Node supports a { writable, readable } pair here since v16.8. The
    // NodeJS typings do not currently model the Node-stream pair overload.
    return Duplex.from({ writable: input, readable: output } as unknown as NodeJS.ReadWriteStream);
  }

  #into(destination: Writable, reverse: boolean, options: OperationOptions): Writable {
    const signal = this.#engine.createOperationSignal(options);
    if (this.#engine.schema) throw new Error('[PipeX] Global object schemas cannot validate raw byte streams');
    const requestId = this.#engine.startRequest();
    const context = this.#streamContext(requestId, signal);
    const mode = reverse ? 'decompress' : 'compress';
    let transforms: ReturnType<typeof buildTransformChain>;
    try {
      transforms = buildTransformChain(
        this.#engine.plugins, mode, reverse,
        bytes => this.#engine.emitProgress(bytes, requestId),
        this.#engine.logger,
        this.#engine.tracer,
        this.#engine.dlq,
        context,
      );
    } catch (error) {
      this.#engine.emitError(error, requestId);
      throw error;
    }

    const source = new PassThrough();
    let finalCallback: ((error?: Error | null) => void) | undefined;
    const endpoint = new Writable({
      write(chunk, encoding, callback) {
        source.write(chunk, encoding, callback);
      },
      final(callback) {
        finalCallback = callback;
        source.end();
      },
      destroy(error, callback) {
        finalCallback = undefined;
        if (!source.destroyed) source.destroy(error ?? undefined);
        callback(error);
      },
    });
    const settleEndpoint = (error?: Error) => {
      const callback = finalCallback;
      finalCallback = undefined;
      if (callback) callback(error);
      else if (error && !endpoint.destroyed) endpoint.destroy(error);
    };

    void runPipeline(source, [
      buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
      ...transforms,
      buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
    ], destination, { signal }).then(async () => {
      this.#engine.endRequest(requestId);
      await this.#engine.emitAudit({
        requestId,
        operation: reverse ? 'reverse' : 'process',
        metadata: { controller: 'stream' },
      });
      settleEndpoint();
    }).catch(error => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.#engine.emitError(failure, requestId);
      settleEndpoint(failure);
    });

    return endpoint;
  }

  /**
   * Returns a Writable that pumps incoming bytes through the plugin pipeline
   * (compress direction) and forwards them to `destination`.
   *
   * @example
   * readableSource.pipe(engine.stream.into(createWriteStream('out')));
   */
  into(destination: Writable, options: OperationOptions = {}): Writable {
    return this.#into(destination, false, options);
  }

  /**
   * Returns a Writable that pumps bytes through the reversed plugin pipeline
   * (decompress direction) and forwards to `destination`.
   *
   * @example
   * readableSource.pipe(engine.stream.reverseInto(createWriteStream('restored')));
   */
  reverseInto(destination: Writable, options: OperationOptions = {}): Writable {
    return this.#into(destination, true, options);
  }

  /**
   * Returns a PackrStream: write JS objects, read msgpack bytes.
   * A manifest header frame is prepended automatically.
   *
   * @example
   * objectSource.pipe(engine.stream.pack()).pipe(tcpSocket);
   */
  pack(options: OperationOptions = {}): Duplex {
    const signal = this.#engine.createOperationSignal(options);
    const requestId = this.#engine.startRequest({ operation: 'pack' });
    const input = new PassThrough({ objectMode: true });
    const output = new PassThrough();
    const transforms = [
      buildObjectLimitTransform(this.#engine.limits.maxFrames),
      createPackrStream(),
      buildManifestHeaderTransform(buildManifest([])),
      buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
    ];
    const duplex = this.#bridge(input, output);
    runPipeline(input, transforms, output, { signal })
      .then(() => {
        this.#engine.endRequest(requestId);
        void this.#engine.emitAudit({ requestId, operation: 'pack', metadata: { controller: 'stream' } })
          .catch(error => this.#engine.emitError(error, requestId));
      })
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
    const signal = this.#engine.createOperationSignal(options);
    const requestId = this.#engine.startRequest({ operation: 'unpack' });
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
    const duplex = this.#bridge(input, output);
    runPipeline(input, transforms, output, { signal })
      .then(() => {
        this.#engine.endRequest(requestId);
        void this.#engine.emitAudit({ requestId, operation: 'unpack', metadata: { controller: 'stream' } })
          .catch(error => this.#engine.emitError(error, requestId));
      })
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
    try {
      const transforms = buildTransformChain(
        this.#engine.plugins, mode, reverse,
        bytes => this.#engine.emitProgress(bytes, requestId),
        this.#engine.logger,
        this.#engine.tracer,
        this.#engine.dlq,
        context,
      );
      await runPipeline(source, [
        buildByteLimitTransform(this.#engine.limits.maxInputBytes, 'input'),
        ...transforms,
        buildByteLimitTransform(this.#engine.limits.maxOutputBytes, 'output'),
      ], destination, { signal });
      this.#engine.endRequest(requestId);
      await this.#engine.emitAudit({
        requestId,
        operation: reverse ? 'reverse' : 'process',
        metadata: { controller: 'stream' },
      });
    } catch (err: unknown) {
      this.#engine.emitError(err, requestId);
      throw err;
    }
  }
}
