import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes 
} from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';
import { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

export type EncryptionType = 'aes-256-gcm' | 'chacha20-poly1305';

// Packet layout (buffer mode):
// [1 byte type][12 bytes IV][16 bytes auth-tag][N bytes ciphertext]
const HEADER_BYTES  = 1;
const IV_BYTES      = 12;
const TAG_BYTES     = 16;
const PREFIX_BYTES  = HEADER_BYTES + IV_BYTES + TAG_BYTES; // 29 total

interface EncryptionOptions {
  type: EncryptionType;
  key: Buffer;
}

export class EncryptionPlugin extends BasePlugin {
  public readonly name = 'encryption-provider';
  public readonly version = '2.1.2';

  private readonly typeMap: Record<EncryptionType, number> = {
    'aes-256-gcm': 1,
    'chacha20-poly1305': 2
  };


  private readonly idToAlgo: Record<number, EncryptionType> = {
    1: 'aes-256-gcm',
    2: 'chacha20-poly1305'
  };

  constructor(protected override options: EncryptionOptions) {
    super(options);
    if (options.key.length !== 32) {
      throw new Error(`[${this.name}] Key must be exactly 32 bytes, got ${options.key.length}.`);
    }
  }

  public override async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(
      this.options.type, this.options.key, iv,
      { authTagLength: TAG_BYTES } as any
    ) as CipherGCM;

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();


    const header = Buffer.allocUnsafe(HEADER_BYTES);
    header.writeUInt8(this.typeMap[this.options.type]);

    return Buffer.concat([header, iv, tag, encrypted]);
  }

  public override async reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    
    if (data.length < PREFIX_BYTES) {
      throw new Error(
        `[${this.name}] Decryption failed: packet too short ` +
        `(${data.length} bytes, minimum is ${PREFIX_BYTES}).`
      );
    }

    try {
      const typeId       = data.readUInt8(0);
      const iv           = data.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
      const tag          = data.subarray(HEADER_BYTES + IV_BYTES, PREFIX_BYTES);
      const encryptedData = data.subarray(PREFIX_BYTES);

      
      const algo = this.idToAlgo[typeId];
      if (!algo) {
        throw new Error(`Unknown encryption type byte: ${typeId}`);
      }

      const decipher = createDecipheriv(
        algo, this.options.key, iv,
        { authTagLength: TAG_BYTES } as any
      ) as DecipherGCM;

      decipher.setAuthTag(tag);

      return Buffer.concat([
        decipher.update(encryptedData),
        decipher.final()
      ]);
    } catch (error: any) {

      if (error.message.startsWith(`[${this.name}]`)) throw error;

      throw new Error(
        `[${this.name}] Decryption failed: invalid key, altered data, or corrupted auth tag.`
      );
    }
  }

 
 
  public createStream(mode: 'compress' | 'decompress'): Transform {
    return mode === 'compress'
      ? this._createEncryptStream()
      : this._createDecryptStream();
  }

  private _createEncryptStream(): Transform {
    const { type, key } = this.options;
    const typeId = this.typeMap[type];
    const iv = randomBytes(IV_BYTES);
 
    const cipher = createCipheriv(type, key, iv, { authTagLength: TAG_BYTES } as any) as CipherGCM;
    const chunks: Buffer[] = [];

    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          chunks.push(cipher.update(chunk));
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
      flush(callback) {
        try {
          const finalChunk = cipher.final();
          if (finalChunk.length) chunks.push(finalChunk);
          const tag = cipher.getAuthTag();

      
          const header = Buffer.allocUnsafe(HEADER_BYTES + IV_BYTES);
          header.writeUInt8(typeId, 0);
          iv.copy(header, HEADER_BYTES);
          this.push(Buffer.concat([header, tag, ...chunks]));
          callback();
        } catch (err) {
          callback(err as Error);
        }
      }
    });
  }

  private _createDecryptStream(): Transform {
    const { key } = this.options;
    const idToAlgo = this.idToAlgo;
    const name = this.name;

  
    let headerBuf = Buffer.alloc(0);
    let headerParsed = false;
    let decipher: DecipherGCM | null = null;

    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          if (!headerParsed) {
            headerBuf = Buffer.concat([headerBuf, chunk]);
            if (headerBuf.length < PREFIX_BYTES) {
              callback(); 
              return;
            }
            const typeId = headerBuf.readUInt8(0);
            const algo = idToAlgo[typeId];
            if (!algo) {
              callback(new Error(`[${name}] Unknown stream type byte: ${typeId}`));
              return;
            }
            const iv  = headerBuf.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
            const tag = headerBuf.subarray(HEADER_BYTES + IV_BYTES, PREFIX_BYTES);
            decipher = createDecipheriv(algo, key, iv, { authTagLength: TAG_BYTES } as any) as DecipherGCM;
            
            decipher.setAuthTag(tag);
            headerParsed = true;
   
            const rest = headerBuf.subarray(PREFIX_BYTES);
            if (rest.length) this.push(decipher.update(rest));
          } else {
            this.push(decipher!.update(chunk));
          }
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
      flush(callback) {
        try {
          if (!decipher) {
            callback(new Error(`[${name}] Stream decryption failed: packet too short.`));
            return;
          }
          const finalChunk = decipher.final(); 
          if (finalChunk.length) this.push(finalChunk);
          callback();
        } catch (err) {
          callback(new Error(`[${name}] Stream decryption failed: invalid key or corrupted stream.`));
        }
      }
    });
  }
}