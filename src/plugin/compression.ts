import { 
  gzipSync, gunzipSync, createGzip, createGunzip,
  brotliCompressSync, brotliDecompressSync, createBrotliCompress, createBrotliDecompress,
  constants as zlibConstants
} from 'node:zlib';
import { Transform, type TransformCallback } from 'node:stream';
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

/**
 * CompressionPlugin — Standard library plugin for Gzip and Brotli.
 * Prepends a 1-byte header to identify the compression type.
 */
export class CompressionPlugin extends BasePlugin {
  public readonly name = 'compression';
  public readonly version = '3.0.0';

  constructor(protected override options: CompressionOptions) {
    super(options);
  }

  public override async process(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    const { type, level } = this.options;
    const header = Buffer.from([TYPE_BYTE_MAP[type]]);

    let compressed: Buffer;
    if (type === 'gzip') {
      compressed = gzipSync(data, { level: level ?? 6 });
    } else if (type === 'brotli') {
      compressed = brotliCompressSync(data, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level ?? 11 }
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

    if (type === 'gzip')   return gunzipSync(payload);
    if (type === 'brotli') return brotliDecompressSync(payload);
    return payload;
  }

  public createStream(mode: 'compress' | 'decompress'): Transform {
    const { type, level } = this.options;
    let headerSent = false;

    if (mode === 'compress') {
      const compressor = type === 'gzip'
        ? createGzip({ level: level ?? 6 })
        : type === 'brotli'
          ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level ?? 11 } })
          : new Transform({ transform(c, _e, cb) { cb(null, c); } });

      return new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
          if (!headerSent) {
            headerSent = true;
            this.push(Buffer.from([TYPE_BYTE_MAP[type]]));
          }
          if (!compressor.write(chunk)) {
            compressor.once('drain', cb);
          } else {
            cb();
          }
        },
        flush(cb: TransformCallback) {
          compressor.end();
          compressor.on('data', (c) => this.push(c));
          compressor.on('end', cb);
        }
      });
    } else {
      // Decompress mode
      let decompressor: Transform | null = null;

      return new Transform({
        transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
          let payload = chunk;
          if (!headerSent) {
            headerSent = true;
            const typeId = chunk.readUInt8(0);
            const detectedType = ID_TO_TYPE[typeId];
            payload = chunk.subarray(1);

            decompressor = detectedType === 'gzip'
              ? createGunzip()
              : detectedType === 'brotli'
                ? createBrotliDecompress()
                : new Transform({ transform(c, _e, cb) { cb(null, c); } });
            
            decompressor.on('data', (c) => this.push(c));
            decompressor.on('error', (e) => this.emit('error', e));
          }

          if (decompressor && payload.length > 0) {
            if (!decompressor.write(payload)) {
              decompressor.once('drain', cb);
            } else {
              cb();
            }
          } else {
            cb();
          }
        },
        flush(cb: TransformCallback) {
          if (decompressor) {
            decompressor.end();
            decompressor.once('end', cb);
          } else {
            cb();
          }
        }
      });
    }
  }
}
