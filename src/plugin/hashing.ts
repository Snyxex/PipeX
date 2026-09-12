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
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/**
 * HashingPlugin — Standard library plugin for HMAC integrity checks.
 * Appends a digest to the end of the buffer/stream.
 */
export class HashingPlugin extends BasePlugin {
  public readonly name = 'hashing';
  public readonly version = '3.0.0';

  constructor(protected override options: HashingOptions) {
    super(options);
    if (!(options.algorithm in HASH_LENGTHS)) throw new Error('[PipeX] Hashing: unknown algorithm');
    if (!options.secret || options.secret.length < 16) {
      throw new Error('[PipeX] Hashing: Secret must be at least 16 characters');
    }
  }

  public override async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    if (data.length > MAX_BUFFER_BYTES) throw new Error('[PipeX] Hashing input exceeds 256 MiB');
    context.metadata ??= {};
    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const digest = hmac.update(data).digest();
    context.metadata['hmac'] = digest.toString('hex');
    const result = Buffer.concat([data, digest]);
    if (result.length > MAX_BUFFER_BYTES) throw new Error('[PipeX] Hashing output exceeds 256 MiB');
    return result;
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

    context.metadata ??= {};
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
      const chunks: Buffer[] = [];
      let total = 0;

      return new Transform({
        transform(chunk: Buffer, _enc, cb) {
          total += chunk.length;
          if (total > MAX_BUFFER_BYTES) return cb(new Error('[PipeX] HMAC stream exceeds 256 MiB'));
          chunks.push(chunk);
          cb();
        },
        flush(cb) {
          const buffer = Buffer.concat(chunks, total);
          if (buffer.length < len) {
            return cb(new Error('[PipeX] Hashing stream: No HMAC found'));
          }
          const originalData = buffer.subarray(0, buffer.length - len);
          const attachedHash = buffer.subarray(buffer.length - len);
          hmac.update(originalData);
          const expected = hmac.digest();
          if (!timingSafeEqual(attachedHash, expected)) {
            return cb(new Error('[PipeX] Hashing stream: HMAC verification failed'));
          }
          this.push(originalData);
          cb();
        }
      });
    }
  }
}
