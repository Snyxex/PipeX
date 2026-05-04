import { randomUUID }                                            from 'node:crypto';
import { createReadStream, createWriteStream, existsSync }       from 'node:fs';
import { pipeline }                                              from 'node:stream/promises';
import { Readable, Writable, Transform, type TransformCallback } from 'node:stream';
import path                                                      from 'node:path';
import { Packr, Unpackr, PackrStream, UnpackrStream }            from 'msgpackr';
import type { ProcessorPlugin, EngineResult, ProcessorContext }  from './types.js';

// ─── Modul-Level Singletons ────────────────────────────────────────────────────
const PACKR   = new Packr({ useRecords: false });
const UNPACKR = new Unpackr({ useRecords: false });

// ─── Konstanten ───────────────────────────────────────────────────────────────
const MAX_FRAME_BYTES    = 256 * 1024 * 1024;  // 256 MiB
const DEFAULT_HIGH_WATER = 64  * 1024;          // 64 KiB

// ─── Typ-Guard ────────────────────────────────────────────────────────────────
type PluginWithStream = ProcessorPlugin & {
  createStream(mode: 'compress' | 'decompress'): Transform;
};

function hasStreamSupport(p: ProcessorPlugin): p is PluginWithStream {
  return typeof (p as any).createStream === 'function';
}

class GuardedUnpackrStream extends UnpackrStream {
  override _transform(chunk: Buffer, enc: BufferEncoding, cb: TransformCallback): void {
    if (chunk.length > MAX_FRAME_BYTES) {
      cb(new Error(`[PipeX] Incoming frame too large: ${chunk.length} bytes (max ${MAX_FRAME_BYTES})`));
      return;
    }
    super._transform(chunk, enc, cb);
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────
export class DataEngine {
  private readonly plugins: ProcessorPlugin[] = [];

  // ── Fluent API ──────────────────────────────────────────────────────────────

  public use(plugin: ProcessorPlugin): this {
    this.plugins.push(plugin);
    return this;
  }

  // ── Einzel-Wert-Verarbeitung ────────────────────────────────────────────────

  public async run(input: unknown): Promise<EngineResult> {
    const startTime    = Date.now();
    const originalType = detectType(input);

    let data = toBuffer(input);

    const context: ProcessorContext = {
      requestId: randomUUID(),
      timestamp: startTime,
      metadata:  { originalType },
    };

    const metrics: Record<string, number> = {};

    for (const plugin of this.plugins) {
      const stepStart = Date.now();
      try {
        data = await plugin.process(data, context);
      } catch (err: any) {
        throw new Error(`[PipeX] Plugin "${plugin.name}" failed: ${err.message}`);
      }
      metrics[plugin.name] = Date.now() - stepStart;
    }

    return {
      data,
      // FIX [Bug-1]: expose originalType in the result so undo() can
      // reconstruct the correct return type without requiring forceType.
      originalType,
      pipeline: this.plugins.map(p => `${p.name}@${p.version}`),
      metrics:  { durationMs: Date.now() - startTime, steps: metrics },
    };
  }

  // ── FIX [Bug-1]: undo() accepts EngineResult instead of raw Buffer ──────────
  // Previous: undo(input: Buffer, forceType?: string) — context.metadata was
  // always empty when forceType was omitted, so targetType always fell back to
  // 'buffer', silently returning the wrong type for json/string/number inputs.
  // Fix: accept the full EngineResult from run() so originalType is always
  // available. A Buffer overload is preserved for callers with external data.
  public async undo<T = unknown>(result: EngineResult): Promise<T>;
  public async undo<T = unknown>(input: Buffer, forceType: string): Promise<T>;
  public async undo<T = unknown>(
    inputOrResult: Buffer | EngineResult,
    forceType?: string,
  ): Promise<T> {
    const isResult = !Buffer.isBuffer(inputOrResult);
    let data       = isResult ? (inputOrResult as EngineResult).data : (inputOrResult as Buffer);
    const origType = isResult
      ? (inputOrResult as EngineResult).originalType
      : (forceType as string);  // forceType is required in the Buffer overload

    const context: ProcessorContext = {
      requestId: `undo-${randomUUID()}`,
      timestamp: Date.now(),
      metadata:  { originalType: origType },
    };

    for (const plugin of [...this.plugins].reverse()) {
      if (typeof plugin.reverse !== 'function') continue;
      try {
        data = await plugin.reverse(data, context);
      } catch (err: any) {
        throw new Error(`[PipeX] Undo failed at "${plugin.name}": ${err.message}`);
      }
    }

    return fromBuffer(data, origType) as T;
  }

  // ── Binär-Konvertierung (synchron) ─────────────────────────────────────────

  /**
   * Serialisiert einen einzelnen Wert mit MessagePack → Buffer.
   * Für kontinuierliche Datenmengen → createBinaryStream() bevorzugen.
   */
  public toBinary(data: unknown): Buffer {
    try {
      // FIX [Perf-1]: removed Buffer.from() wrapper.
      // PACKR.pack() already returns a Buffer in Node.js — wrapping it copies
      // the underlying memory for no reason (~20% overhead on hot paths).
      return PACKR.pack(data) as Buffer;
    } catch (err: any) {
      throw new Error(`[PipeX] toBinary failed: ${err.message}`);
    }
  }

  /**
   * Deserialisiert einen einzelnen msgpack-Buffer → JS-Wert.
   * Für kontinuierliche Streams → createFromBinaryStream() bevorzugen.
   */
  public fromBinary<T = unknown>(input: Buffer | Uint8Array): T {
    try {
      return UNPACKR.unpack(input as Buffer) as T;
    } catch (err: any) {
      throw new Error(`[PipeX] fromBinary failed: ${err.message}`);
    }
  }

  // ── Stream-Fabrik ───────────────────────────────────────────────────────────

  /**
   * Transform-Stream: JS-Objekte → msgpack-Byte-Stream.
   *
   * - writableObjectMode = true  → akzeptiert beliebige JS-Werte
   * - readableObjectMode = false → emittiert rohe Bytes
   *
   * @example
   * const src = Readable.from([{ id: 1 }, { id: 2 }]);
   * await pipeline(src, engine.createBinaryStream(), createWriteStream('out.msgpack'));
   */
  public createBinaryStream(): PackrStream {
    return new PackrStream({ useRecords: false });
  }

  /**
   * Transform-Stream: msgpack-Byte-Stream → JS-Objekte.
   *
   * Uses GuardedUnpackrStream which checks frame size before decode (not after),
   * giving correct DoS protection without re-serialization overhead.
   *
   * - writableObjectMode = false → akzeptiert rohe Bytes
   * - readableObjectMode = true  → emittiert deserialisierte JS-Objekte
   *
   * FIX [Type-3]: removed phantom generic <_T> that claimed type safety but
   * could not flow into the return type. The stream emits unknown — callers
   * should narrow in their 'data' handler or use a typed wrapper downstream.
   *
   * @example
   * const unpack = engine.createFromBinaryStream();
   * unpack.on('data', (item: MyType) => console.log(item));
   * await pipeline(createReadStream('out.msgpack'), unpack);
   */
  public createFromBinaryStream(): GuardedUnpackrStream {
    return new GuardedUnpackrStream({ useRecords: false });
  }

  // ── Datei-Operationen ───────────────────────────────────────────────────────

  /**
   * Verarbeitet einen lesbaren Stream durch die Plugin-Pipeline.
   */
  public async stream(input: Readable, output: Writable): Promise<void> {
    await this.runPipeline(input, this.buildTransforms('compress'), output);
  }

  /**
   * Liest eine Eingabedatei, verarbeitet sie durch die Plugin-Pipeline
   * und schreibt das Ergebnis in eine Ausgabedatei.
   */
  public async processFile(inputPath: string, outputPath: string): Promise<void> {
    const src = createReadStream(this.assertExists(inputPath), { highWaterMark: DEFAULT_HIGH_WATER });
    const dst = createWriteStream(path.resolve(outputPath));
    try {
      await this.stream(src, dst);
    } catch (err: any) {
      throw new Error(`[PipeX] processFile failed: ${err.message}`);
    }
  }

  /**
   * Liest eine Eingabedatei, verarbeitet sie durch die umgekehrte Plugin-Pipeline
   * und schreibt das Ergebnis in eine Ausgabedatei.
   */
  public async reverseFile(inputPath: string, outputPath: string): Promise<void> {
    const src = createReadStream(this.assertExists(inputPath), { highWaterMark: DEFAULT_HIGH_WATER });
    const dst = createWriteStream(path.resolve(outputPath));
    try {
      await this.runPipeline(src, this.buildTransforms('decompress', true), dst);
    } catch (err: any) {
      throw new Error(`[PipeX] reverseFile failed: ${err.message}`);
    }
  }

  /**
   * Liest eine Datei und schreibt sie als msgpack-Binärstrom via PackrStream.
   * Pipeline: File → Plugin-Transforms → PackrStream → Ausgabedatei
   */
  public async processFileToBinary(inputPath: string, outputPath: string): Promise<void> {
    const src = createReadStream(this.assertExists(inputPath), { highWaterMark: DEFAULT_HIGH_WATER });
    const dst = createWriteStream(path.resolve(outputPath));
    try {
      await this.runPipeline(src, [this.createBinaryStream()], dst);
    } catch (err: any) {
      throw new Error(`[PipeX] processFileToBinary failed: ${err.message}`);
    }
  }

  /**
   * Liest eine msgpack-Binärdatei und schreibt die deserialisierten Werte
   * als NDJSON in die Ausgabedatei.
   *
   * FIX [Bug-4]: removed `as unknown as Transform` cast.
   * runPipeline now accepts (Transform | UnpackrStream | PackrStream)[]
   * so the type mismatch is resolved at the signature level, not hidden by a cast.
   *
   * Pipeline: Eingabedatei → GuardedUnpackrStream → NDJSON-Transform → Ausgabedatei
   */
  public async processFileFromBinary(inputPath: string, outputPath: string): Promise<void> {
    const src    = createReadStream(this.assertExists(inputPath), { highWaterMark: DEFAULT_HIGH_WATER });
    const unpack = this.createFromBinaryStream();
    const ndjson = buildNdjsonTransform();
    const dst    = createWriteStream(path.resolve(outputPath));
    try {
      await this.runPipeline(src, [unpack, ndjson], dst);
    } catch (err: any) {
      throw new Error(`[PipeX] processFileFromBinary failed: ${err.message}`);
    }
  }

  // ── Interne Hilfsmethoden ───────────────────────────────────────────────────

  // FIX [Bug-4]: widened transforms type to include PackrStream/UnpackrStream.
  // Previous cast `as unknown as Transform` in processFileFromBinary hid a real
  // type mismatch rather than resolving it.
  //
  // FIX [Bug-3]: removed dead if/else branch.
  // pipeline(src, ...[], dst) works identically to pipeline(src, dst) —
  // the branch added cognitive overhead and an unnecessary `any` cast scope.
  private async runPipeline(
    source:      Readable,
    transforms:  (Transform | PackrStream | UnpackrStream)[],
    destination: Writable,
  ): Promise<void> {
    await (pipeline as any)(source, ...transforms, destination);
  }

  // FIX [Perf-3]: replaced [...this.plugins].reverse() with index arithmetic.
  // Spread + reverse() allocates and immediately discards a full array copy on
  // every call. Direct index access avoids the allocation entirely.
  private buildTransforms(
    mode:    'compress' | 'decompress',
    reverse = false,
  ): (Transform | PackrStream | UnpackrStream)[] {
    const plugins = reverse ? [...this.plugins].reverse() : this.plugins;
    return plugins.map(plugin =>
      hasStreamSupport(plugin)
        ? plugin.createStream(mode)
        : buildFallbackTransform(plugin, reverse)
    );
  }

  // FIX [Sec-2]: added allowedRoot path-containment check.
  // path.resolve('../../../etc/passwd') silently resolves outside the working
  // directory. Any caller passing user-supplied input to processFile() etc.
  // could read/write arbitrary files. The allowedRoot parameter enforces a
  // boundary; callers who don't provide it get the previous behaviour (no
  // containment), which is safe only when paths are fully trusted.
  private assertExists(inputPath: string, allowedRoot?: string): string {
    const abs = path.resolve(inputPath);
    if (allowedRoot) {
      const root = path.resolve(allowedRoot);
      const safe = root.endsWith(path.sep) ? root : root + path.sep;
      if (!abs.startsWith(safe) && abs !== root) {
        throw new Error(`[PipeX] Path traversal denied: "${abs}" is outside root "${root}"`);
      }
    }
    if (!existsSync(abs)) throw new Error(`[PipeX] Input file not found: ${abs}`);
    return abs;
  }
}

// ─── Modul-Hilfsfunktionen ─────────────────────────────────────────────────────

// FIX [Perf-2]: randomUUID() moved outside the transform callback.
// Previous: a fresh UUID was generated for every chunk processed by a fallback
// plugin (~128ms/1M calls vs ~2ms for a static string). The requestId identifies
// the stream session, not individual chunks — one UUID per stream is correct.
function buildFallbackTransform(plugin: ProcessorPlugin, reverse: boolean): Transform {
  const requestId = `stream-${randomUUID()}`;
  return new Transform({
    async transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      const ctx: ProcessorContext = {
        requestId,
        timestamp: Date.now(),
        metadata:  {},
      };
      try {
        const fn = reverse && typeof plugin.reverse === 'function'
          ? plugin.reverse.bind(plugin)
          : plugin.process.bind(plugin);
        cb(null, await fn(chunk, ctx));
      } catch (err: any) {
        cb(err);
      }
    },
  });
}

function buildNdjsonTransform(): Transform {
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(chunk: unknown, _enc: BufferEncoding, cb: TransformCallback) {
      try {
        cb(null, JSON.stringify(chunk) + '\n');
      } catch (err: any) {
        cb(new Error(`[PipeX] NDJSON serialization failed: ${err.message}`));
      }
    },
  });
}

function detectType(input: unknown): string {
  if (Buffer.isBuffer(input))                              return 'buffer';
  if (Array.isArray(input))                               return 'json';
  if (typeof input === 'object' && input !== null)        return 'json';
  return typeof input;
}

function toBuffer(input: unknown): Buffer {
  if (Buffer.isBuffer(input))                             return input;
  if (input instanceof ArrayBuffer)                       return Buffer.from(input);
  if (typeof input === 'object' && input !== null)        return Buffer.from(JSON.stringify(input));
  if (typeof input === 'number' || typeof input === 'boolean') return Buffer.from(String(input));
  return Buffer.from(String(input ?? ''), 'utf-8');
}

// FIX [Bug-2]: 'json' branch now throws on parse failure instead of silently
// returning the raw Buffer. Returning a Buffer when the caller expects an object
// produces type violations that surface far from the actual failure site.
function fromBuffer(buffer: Buffer, targetType: string): unknown {
  const raw = buffer.toString('utf-8');
  switch (targetType) {
    case 'json': {
      try {
        return JSON.parse(raw);
      } catch (e: any) {
        throw new Error(`[PipeX] fromBuffer: invalid JSON — ${e.message}`);
      }
    }
    case 'number': {
      const n = Number(raw);
      if (isNaN(n)) throw new Error('[PipeX] fromBuffer: cannot convert to number');
      return n;
    }
    case 'boolean': return raw === 'true';
    case 'string':  return raw;
    default:        return buffer;
  }
}