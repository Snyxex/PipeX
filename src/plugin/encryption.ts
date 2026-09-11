import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes 
} from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305';

export interface EncryptionOptions {
  algorithm: EncryptionAlgorithm;
  key: Buffer;
}

const ALGO_MAP: Record<EncryptionAlgorithm, number> = {
  'aes-256-gcm': 1,
  'chacha20-poly1305': 2,
};

const ID_TO_ALGO: Record<number, EncryptionAlgorithm> = {
  1: 'aes-256-gcm',
  2: 'chacha20-poly1305',
};

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH; // [algo][iv][tag]
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/**
 * EncryptionPlugin — Standard library plugin for AES-GCM and ChaCha20-Poly1305.
 * Uses a combined header: [1B algo][12B IV][16B AuthTag]
 */
export class EncryptionPlugin extends BasePlugin {
  public readonly name = 'encryption';
  public readonly version = '3.0.0';

  constructor(protected override options: EncryptionOptions) {
    super(options);
    if (!(options.algorithm in ALGO_MAP) || !Buffer.isBuffer(options.key)) {
      throw new Error('[PipeX] Encryption: invalid algorithm or key');
    }
    if (options.key.length !== 32) {
      throw new Error('[PipeX] Encryption: Key must be 32 bytes');
    }
  }

  public override async process(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    if (data.length > MAX_BUFFER_BYTES) throw new Error('[PipeX] Encryption input exceeds 256 MiB');
    const { algorithm, key } = this.options;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(algorithm, key, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
    
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.allocUnsafe(1);
    header.writeUInt8(ALGO_MAP[algorithm]);

    return Buffer.concat([header, iv, tag, encrypted]);
  }

  public override async reverse(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    if (data.length < HEADER_LENGTH) throw new Error('[PipeX] Decryption failed: packet too short');

    const algoId = data.readUInt8(0);
    const algo = ID_TO_ALGO[algoId];
    if (!algo) throw new Error('[PipeX] Decryption failed: unknown algorithm');
    const iv = data.subarray(1, 1 + IV_LENGTH);
    const tag = data.subarray(1 + IV_LENGTH, HEADER_LENGTH);
    const ciphertext = data.subarray(HEADER_LENGTH);

    const decipher = createDecipheriv(algo, this.options.key, iv, { authTagLength: TAG_LENGTH } as any) as DecipherGCM;
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  public createStream(mode: 'compress' | 'decompress'): Transform {
    const { algorithm, key } = this.options;

    if (mode === 'compress') {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(algorithm, key, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
      const dataChunks: Buffer[] = [];
      let total = 0;

      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          total += chunk.length;
          if (total > MAX_BUFFER_BYTES) return cb(new Error('[PipeX] Encryption stream exceeds 256 MiB'));
          dataChunks.push(cipher.update(chunk));
          cb();
        },
        flush(cb) {
          dataChunks.push(cipher.final());
          const tag = cipher.getAuthTag();
          
          const head = Buffer.allocUnsafe(1);
          head.writeUInt8(ALGO_MAP[algorithm]);
          
          this.push(Buffer.concat([head, iv, tag, ...dataChunks]));
          cb();
        }
      });
    } else {
      // Decompress (Decrypt)
      let headBuf = Buffer.alloc(0);
      let decipher: DecipherGCM | null = null;

      const plaintextChunks: Buffer[] = [];
      let totalPlaintext = 0;
      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (!decipher) {
            headBuf = Buffer.concat([headBuf, chunk]);
            if (headBuf.length >= HEADER_LENGTH) {
              const algoId = headBuf.readUInt8(0);
              const algo = ID_TO_ALGO[algoId];
              if (!algo) return cb(new Error('[PipeX] Stream decryption failed: unknown algorithm'));
              const iv = headBuf.subarray(1, 1 + IV_LENGTH);
              const tag = headBuf.subarray(1 + IV_LENGTH, HEADER_LENGTH);
              
              decipher = createDecipheriv(algo, key, iv, { authTagLength: TAG_LENGTH } as any) as DecipherGCM;
              decipher.setAuthTag(tag);
              
              const rest = headBuf.subarray(HEADER_LENGTH);
               if (rest.length > 0) { totalPlaintext += rest.length; plaintextChunks.push(decipher.update(rest)); }
              headBuf = Buffer.alloc(0);
            }
          } else {
            totalPlaintext += chunk.length;
            if (totalPlaintext > MAX_BUFFER_BYTES) return cb(new Error('[PipeX] Decryption stream exceeds 256 MiB'));
            plaintextChunks.push(decipher.update(chunk));
          }
          cb();
        },
        flush(cb: TransformCallback) {
          if (!decipher) return cb(new Error('[PipeX] Stream decryption failed: No header'));
          try {
            plaintextChunks.push(decipher.final());
            this.push(Buffer.concat(plaintextChunks));
            cb();
          } catch (e) {
            cb(e as Error);
          }
        }
      });
    }
  }
}
