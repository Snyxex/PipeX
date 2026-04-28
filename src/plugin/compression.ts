import { 
  gzipSync, gunzipSync, createGzip, createGunzip,
  brotliCompressSync, brotliDecompressSync, createBrotliCompress, createBrotliDecompress,
  constants as zlibConstants
} from 'zlib';
import { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

export type CompressionType = 'gzip' | 'brotli' | 'none';

interface CompressionOptions {
  type: CompressionType;
  level?: number;
}


const HEADER_BYTES = 1;

export class CompressionPlugin extends BasePlugin {
  public readonly name = 'compression-provider';
  public readonly version = '2.0.0';

  private readonly typeMap: Record<CompressionType, number> = {
    'none':   0,
    'gzip':   1,
    'brotli': 2,
  };

  constructor(protected override options: CompressionOptions) {
    super(options);
  }



  public override async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    const { type, level } = this.options;

    const header = Buffer.allocUnsafe(HEADER_BYTES);
    header.writeUInt8(this.typeMap[type]);

    if (type === 'none') {
      return Buffer.concat([header, data]);
    }

    if (type === 'gzip') {
      const compressed = gzipSync(data, { level: level ?? 6 });
      return Buffer.concat([header, compressed]);
    }

   
    const brotliOptions = level !== undefined
      ? { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level } }
      : undefined;
    const compressed = brotliCompressSync(data, brotliOptions);
    return Buffer.concat([header, compressed]);
  }

  public override async reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
   
    if (data.length < HEADER_BYTES) {
      throw new Error(`[${this.name}] Decompression failed: packet too short (${data.length} bytes).`);
    }

    const typeId  = data.readUInt8(0);
    const payload = data.subarray(HEADER_BYTES);

    if (typeId === 0) return payload;           
    if (typeId === 1) return gunzipSync(payload);
    if (typeId === 2) return brotliDecompressSync(payload);

    throw new Error(`[${this.name}] Decompression failed: unknown type ID ${typeId}.`);
  }

  public createStream(mode: 'compress' | 'decompress'): Transform {
    return mode === 'compress'
      ? this._createCompressStream()
      : this._createDecompressStream();
  }

  private _createCompressStream(): Transform {
    const { type, level } = this.options;
    const typeIdByte = Buffer.from([this.typeMap[type]]);

    if (type === 'none') {
      let headerWritten = false;
      return new Transform({
        transform(chunk, _enc, cb) {
          if (!headerWritten) { this.push(typeIdByte); headerWritten = true; }
          cb(null, chunk);
        }
      });
    }

    const zlibStream = type === 'gzip'
      ? createGzip({ level: level ?? 6 })
      : createBrotliCompress(
          level !== undefined
            ? { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level } }
            : undefined
        );

    let headerWritten = false;

    
    return new Transform({
      construct(cb) {
        zlibStream.on('data', (c: Buffer) => { this.push(c); });
        zlibStream.on('error', (e: Error) => { this.destroy(e); });
        cb();
      },
      transform(chunk, _enc, cb) {
        if (!headerWritten) { this.push(typeIdByte); headerWritten = true; }
        if (!zlibStream.write(chunk)) {
          zlibStream.once('drain', cb);
        } else {
          cb();
        }
      },
      flush(cb) {
        zlibStream.end();
        zlibStream.once('end', () => cb());
      }
    });
  }

  private _createDecompressStream(): Transform {
    const { type } = this.options;

    if (type === 'none') {
      let headerStripped = false;
      return new Transform({
        transform(chunk, _enc, cb) {
          if (!headerStripped) {
            headerStripped = true;
            cb(null, chunk.subarray(HEADER_BYTES));
          } else {
            cb(null, chunk);
          }
        }
      });
    }

    const zlibStream = type === 'gzip'
      ? createGunzip()
      : createBrotliDecompress();

    let headerStripped = false;

    return new Transform({
      construct(cb) {
        zlibStream.on('data', (c: Buffer) => { this.push(c); });
        zlibStream.on('error', (e: Error) => { this.destroy(e); });
        cb();
      },
      transform(chunk, _enc, cb) {
        const payload = !headerStripped
          ? (headerStripped = true, chunk.subarray(HEADER_BYTES))
          : chunk;
        if (payload.length === 0) { cb(); return; }
        if (!zlibStream.write(payload)) {
          zlibStream.once('drain', cb);
        } else {
          cb();
        }
      },
      flush(cb) {
        zlibStream.end();
        zlibStream.once('end', () => cb());
      }
    });
  }
}