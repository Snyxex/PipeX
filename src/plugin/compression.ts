import { 
  gzip, gunzip, createGzip, createGunzip,
  brotliCompress, brotliDecompress, createBrotliCompress, createBrotliDecompress,
  constants as zlibConstants
} from 'node:zlib';
import { promisify } from 'node:util';
import { compose, Duplex, PassThrough, Transform, type TransformCallback } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

export type CompressionType = 'gzip' | 'brotli' | 'none';

export interface CompressionOptions {
  type: CompressionType;
  level?: number;
}

const TYPE_BYTE_MAP: Record<CompressionType, number> = {
  'none':   0,
  'gzip':   1,
  'brotli': 2,
};

const ID_TO_TYPE: Record<number, CompressionType> = {
  0: 'none',
  1: 'gzip',
  2: 'brotli',
};
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

/**
 * CompressionPlugin — Standard library plugin for Gzip and Brotli.
 * Prepends a 1-byte header to identify the compression type.
 */
export class CompressionPlugin extends BasePlugin {
  public readonly name = 'compression';
  public readonly version = '3.0.0';

  constructor(protected override options: CompressionOptions) {
    super(options);
    if (!(options.type in TYPE_BYTE_MAP)) throw new Error('[PipeX] Compression: unknown type');
    if (options.level !== undefined && !Number.isInteger(options.level)) {
      throw new Error('[PipeX] Compression: level must be an integer');
    }
    if (options.type === 'gzip' && options.level !== undefined && (options.level < 0 || options.level > 9)) {
      throw new Error('[PipeX] Compression: gzip level must be between 0 and 9');
    }
    if (options.type === 'brotli' && options.level !== undefined && (options.level < 0 || options.level > 11)) {
      throw new Error('[PipeX] Compression: Brotli level must be between 0 and 11');
    }
    if (options.type === 'none' && options.level !== undefined) {
      throw new Error('[PipeX] Compression: level is not supported when type is none');
    }
  }

  public override async process(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    if (data.length > MAX_BUFFER_BYTES) throw new Error('[PipeX] Compression input exceeds 256 MiB');
    const { type, level } = this.options;
    const header = Buffer.from([TYPE_BYTE_MAP[type]]);

    let compressed: Buffer;
    if (type === 'gzip') {
      compressed = await gzipAsync(data, { level: level ?? 6, maxOutputLength: MAX_BUFFER_BYTES });
    } else if (type === 'brotli') {
      compressed = await brotliCompressAsync(data, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level ?? 11 },
        maxOutputLength: MAX_BUFFER_BYTES,
      });
    } else {
      compressed = data;
    }

    return Buffer.concat([header, compressed]);
  }

  public override async reverse(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    if (data.length < 1) throw new Error('[PipeX] Compression reverse: packet too short');
    
    const typeId = data.readUInt8(0);
    const type = ID_TO_TYPE[typeId];
    const payload = data.subarray(1);

    if (type === 'gzip') {
      const out = await gunzipAsync(payload, { maxOutputLength: MAX_BUFFER_BYTES });
      return out;
    }
    if (type === 'brotli') {
      const out = await brotliDecompressAsync(payload, { maxOutputLength: MAX_BUFFER_BYTES });
      return out;
    }
    if (type !== 'none') throw new Error('[PipeX] Compression: unknown type');
    return payload;
  }

  public createStream(mode: 'compress' | 'decompress'): Duplex {
    const { type, level } = this.options;

    if (mode === 'compress') {
      const compressor = type === 'gzip'
        ? createGzip({ level: level ?? 6 })
        : type === 'brotli'
          ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level ?? 11 } })
          : new PassThrough();
      let headerSent = false;
      const prependHeader = new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
          if (!headerSent) {
            headerSent = true;
            this.push(Buffer.from([TYPE_BYTE_MAP[type]]));
          }
          cb(null, chunk);
        },
        flush(cb: TransformCallback) {
          if (!headerSent) this.push(Buffer.from([TYPE_BYTE_MAP[type]]));
          cb();
        },
      });
      return compose(compressor, prependHeader);
    }

    let decompressor: Transform | null = null;
    let headerSeen = false;
    return new Transform({
      transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
        let payload = chunk;
        if (!headerSeen) {
          headerSeen = true;
          if (chunk.length < 1) return cb(new Error('[PipeX] Stream decompression: packet too short'));
          const detectedType = ID_TO_TYPE[chunk.readUInt8(0)];
          if (!detectedType) return cb(new Error('[PipeX] Stream decompression: unknown type'));
          payload = chunk.subarray(1);
          decompressor = detectedType === 'gzip'
            ? createGunzip()
            : detectedType === 'brotli'
              ? createBrotliDecompress()
              : new PassThrough();
          decompressor.on('data', value => this.push(value));
          decompressor.once('error', error => this.destroy(error));
        }

        const active = decompressor;
        if (!active) return cb(new Error('[PipeX] Stream decompression: missing decoder'));
        if (payload.length === 0 || active.write(payload)) cb();
        else active.once('drain', cb);
      },
      flush(cb: TransformCallback) {
        if (!decompressor) {
          return cb(new Error('[PipeX] Stream decompression: packet too short'));
        }
        decompressor.once('end', cb);
        decompressor.end();
      },
      destroy(error, cb) {
        decompressor?.destroy();
        cb(error);
      },
    });
  }
}
