import { createHmac, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

export type HashAlgorithm = 'sha256' | 'sha512';

export interface HashingOptions {
  algorithm: HashAlgorithm;
  secret: string;
}

const HASH_LENGTHS: Record<HashAlgorithm, number> = {
  'sha256': 32,
  'sha512': 64,
};

/**
 * HashingPlugin — Standard library plugin for HMAC integrity checks.
 * Appends a digest to the end of the buffer/stream.
 */
export class HashingPlugin extends BasePlugin {
  public readonly name = 'hashing';
  public readonly version = '3.0.0';

  constructor(protected override options: HashingOptions) {
    super(options);
    if (!options.secret || options.secret.length < 16) {
      throw new Error('[PipeX] Hashing: Secret must be at least 16 characters');
    }
  }

  public override async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const digest = hmac.update(data).digest();
    context.metadata['hmac'] = digest.toString('hex');
    return Buffer.concat([data, digest]);
  }

  public override async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const len = HASH_LENGTHS[this.options.algorithm];
    if (data.length < len) throw new Error('[PipeX] Hashing reverse: data too short');

    const originalData = data.subarray(0, data.length - len);
    const attachedHash = data.subarray(data.length - len);

    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const expected = hmac.update(originalData).digest();

    if (!timingSafeEqual(attachedHash, expected)) {
      throw new Error('[PipeX] Hashing: HMAC verification failed');
    }

    context.metadata['verified_hmac'] = attachedHash.toString('hex');
    return originalData;
  }

  public createStream(mode: 'compress' | 'decompress'): Transform {
    const { algorithm, secret } = this.options;
    const hmac = createHmac(algorithm, secret);
    const len = HASH_LENGTHS[algorithm];

    if (mode === 'compress') {
      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hmac.update(chunk);
          this.push(chunk);
          cb();
        },
        flush(cb) {
          this.push(hmac.digest());
          cb();
        }
      });
    } else {
      // Verification mode
      let buffer = Buffer.alloc(0);

      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          buffer = Buffer.concat([buffer, chunk]);
          // Keep at least len bytes in the buffer to avoid hashing the trailing HMAC
          if (buffer.length > len) {
            const toProcess = buffer.subarray(0, buffer.length - len);
            hmac.update(toProcess);
            this.push(toProcess);
            buffer = buffer.subarray(buffer.length - len);
          }
          cb();
        },
        flush(cb) {
          if (buffer.length !== len) {
            return cb(new Error('[PipeX] Hashing stream: No HMAC found'));
          }
          const expected = hmac.digest();
          if (!timingSafeEqual(buffer, expected)) {
            return cb(new Error('[PipeX] Hashing stream: HMAC verification failed'));
          }
          cb();
        }
      });
    }
  }
}
