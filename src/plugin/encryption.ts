import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes 
} from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import { pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';

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

  public override async process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const maxInputBytes = pluginInputLimit(ctx);
    const maxOutputBytes = pluginOutputLimit(ctx);
    if (data.length > maxInputBytes) throw new Error(`[PipeX] Encryption input exceeds ${maxInputBytes} bytes`);
    if (data.length > maxOutputBytes - HEADER_LENGTH) {
      throw new Error(`[PipeX] Encryption output exceeds ${maxOutputBytes} bytes`);
    }
    const { algorithm, key } = this.options;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(algorithm, key, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
    
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.allocUnsafe(1);
    header.writeUInt8(ALGO_MAP[algorithm]);

    return Buffer.concat([header, iv, tag, encrypted]);
  }

  public override async reverse(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const maxInputBytes = pluginInputLimit(ctx);
    const maxOutputBytes = pluginOutputLimit(ctx);
    if (data.length > maxInputBytes) throw new Error(`[PipeX] Decryption input exceeds ${maxInputBytes} bytes`);
    if (data.length < HEADER_LENGTH) throw new Error('[PipeX] Decryption failed: packet too short');
    if (data.length - HEADER_LENGTH > maxOutputBytes) {
      throw new Error(`[PipeX] Decryption output exceeds ${maxOutputBytes} bytes`);
    }

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

  public createStream(mode: 'compress' | 'decompress', context?: StreamPluginContext): Transform {
    const { algorithm, key } = this.options;
    const maxInputBytes = pluginInputLimit(context);
    const maxOutputBytes = pluginOutputLimit(context);

    if (mode === 'compress') {
      if (maxOutputBytes < HEADER_LENGTH) {
        throw new Error(`[PipeX] Encryption output exceeds ${maxOutputBytes} bytes`);
      }
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(algorithm, key, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
      const dataChunks: Buffer[] = [];
      let total = 0;

      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (chunk.length > maxInputBytes - total) {
            return cb(new Error(`[PipeX] Encryption input exceeds ${maxInputBytes} bytes`));
          }
          if (chunk.length > maxOutputBytes - HEADER_LENGTH - total) {
            return cb(new Error(`[PipeX] Encryption output exceeds ${maxOutputBytes} bytes`));
          }
          total += chunk.length;
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
      const outputBoundedInput = maxOutputBytes > Number.MAX_SAFE_INTEGER - HEADER_LENGTH
        ? Number.MAX_SAFE_INTEGER
        : maxOutputBytes + HEADER_LENGTH;
      let headBuf = Buffer.alloc(0);
      let decipher: DecipherGCM | null = null;

      const plaintextChunks: Buffer[] = [];
      let totalInput = 0;
      let totalPlaintext = 0;
      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (chunk.length > maxInputBytes - totalInput) {
            return cb(new Error(`[PipeX] Decryption input exceeds ${maxInputBytes} bytes`));
          }
          if (chunk.length > outputBoundedInput - totalInput) {
            return cb(new Error(`[PipeX] Decryption output exceeds ${maxOutputBytes} bytes`));
          }
          totalInput += chunk.length;
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
              if (rest.length > 0) {
                const plaintext = decipher.update(rest);
                if (plaintext.length > maxOutputBytes - totalPlaintext) {
                  return cb(new Error(`[PipeX] Decryption output exceeds ${maxOutputBytes} bytes`));
                }
                totalPlaintext += plaintext.length;
                plaintextChunks.push(plaintext);
              }
              headBuf = Buffer.alloc(0);
            }
          } else {
            const plaintext = decipher.update(chunk);
            if (plaintext.length > maxOutputBytes - totalPlaintext) {
              return cb(new Error(`[PipeX] Decryption output exceeds ${maxOutputBytes} bytes`));
            }
            totalPlaintext += plaintext.length;
            plaintextChunks.push(plaintext);
          }
          cb();
        },
        flush(cb: TransformCallback) {
          if (!decipher) return cb(new Error('[PipeX] Stream decryption failed: No header'));
          try {
            const final = decipher.final();
            if (final.length > maxOutputBytes - totalPlaintext) {
              return cb(new Error(`[PipeX] Decryption output exceeds ${maxOutputBytes} bytes`));
            }
            plaintextChunks.push(final);
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
