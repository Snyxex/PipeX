import { 
  gzipSync, gunzipSync, createGzip, createGunzip,
  brotliCompressSync, brotliDecompressSync, createBrotliCompress, createBrotliDecompress 
} from 'zlib';
import { Transform } from 'stream';
import { BasePlugin } from '../core/plugin';
import type { ProcessorContext } from '../core/types';

export type CompressionType = 'gzip' | 'brotli' | 'none';

interface CompressionOptions {
  type: CompressionType;
  level?: number;
}

export class CompressionPlugin extends BasePlugin {
  public readonly name = 'compression-provider';
  public readonly version = '2.0.0';

  private readonly typeMap: Record<CompressionType, number> = {
    'none': 0,
    'gzip': 1,
    'brotli': 2
  };

  constructor(protected options: CompressionOptions) {
    super(options);
  }

  /**
   * BUFFER MODE: Für kleine Datenmengen (run)
   */
  public async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const { type, level } = this.options;
    let compressed: Buffer;

    if (type === 'none') return data;

    if (type === 'gzip') {
      compressed = gzipSync(data, { level: level || 6 });
    } else {
      compressed = brotliCompressSync(data);
    }

    // Header hinzufügen: [TypeID][Data]
    const header = Buffer.alloc(1);
    header.writeUInt8(this.typeMap[type]);
    return Buffer.concat([header, compressed]);
  }

  /**
   * REVERSE BUFFER: Für die Wiederherstellung (undo)
   */
  public async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const typeId = data.readUInt8(0);
    const payload = data.subarray(1);

    if (typeId === 0) return payload;
    if (typeId === 1) return gunzipSync(payload);
    if (typeId === 2) return brotliDecompressSync(payload);

    throw new Error(`[Compression] Unknown type ID: ${typeId}`);
  }

  /**
   * STREAM MODE: Erstellt einen Transform-Stream für DataEngine.stream()
   */
  public createStream(mode: 'compress' | 'decompress'): Transform {
    const { type, level } = this.options;

    if (type === 'none') return new Transform({ 
      transform(chunk, _, cb) { cb(null, chunk); } 
    });

    if (mode === 'compress') {
      // WICHTIG: Im Stream-Modus müssten wir den Header manuell handhaben.
      // Der Einfachheit halber erstellen wir hier den Standard-Zlib-Stream.
      return type === 'gzip' 
        ? createGzip({ level: level || 6 }) 
        : createBrotliCompress();
    } else {
      return type === 'gzip' 
        ? createGunzip() 
        : createBrotliDecompress();
    }
  }
}