import { createHmac, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import { pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';

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
    if (!(options.algorithm in HASH_LENGTHS)) throw new Error('[PipeX] Hashing: unknown algorithm');
    if (!options.secret || options.secret.length < 16) {
      throw new Error('[PipeX] Hashing: Secret must be at least 16 characters');
    }
  }

  public override async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const maxInputBytes = pluginInputLimit(context);
    const maxOutputBytes = pluginOutputLimit(context);
    const digestLength = HASH_LENGTHS[this.options.algorithm];
    if (data.length > maxInputBytes) throw new Error(`[PipeX] Hashing input exceeds ${maxInputBytes} bytes`);
    if (data.length > maxOutputBytes - digestLength) {
      throw new Error(`[PipeX] Hashing output exceeds ${maxOutputBytes} bytes`);
    }
    context.metadata ??= {};
    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const digest = hmac.update(data).digest();
    context.metadata['hmac'] = digest.toString('hex');
    const result = Buffer.concat([data, digest]);
    return result;
  }

  public override async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const len = HASH_LENGTHS[this.options.algorithm];
    const maxInputBytes = pluginInputLimit(context);
    const maxOutputBytes = pluginOutputLimit(context);
    if (data.length > maxInputBytes) throw new Error(`[PipeX] Hashing input exceeds ${maxInputBytes} bytes`);
    if (data.length < len) throw new Error('[PipeX] Hashing reverse: data too short');
    if (data.length - len > maxOutputBytes) throw new Error(`[PipeX] Hashing output exceeds ${maxOutputBytes} bytes`);

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

  public createStream(mode: 'compress' | 'decompress', context?: StreamPluginContext): Transform {
    const { algorithm, secret } = this.options;
    const hmac = createHmac(algorithm, secret);
    const len = HASH_LENGTHS[algorithm];
    const maxInputBytes = pluginInputLimit(context);
    const maxOutputBytes = pluginOutputLimit(context);

    if (mode === 'compress') {
      let total = 0;
      return new Transform({
        construct(callback) {
          callback(maxOutputBytes < len
            ? new Error(`[PipeX] Hashing output exceeds ${maxOutputBytes} bytes`)
            : undefined);
        },
        transform(chunk: Buffer, _enc, cb) {
          if (chunk.length > maxInputBytes - total) {
            return cb(new Error(`[PipeX] Hashing input exceeds ${maxInputBytes} bytes`));
          }
          if (chunk.length > maxOutputBytes - len - total) {
            return cb(new Error(`[PipeX] Hashing output exceeds ${maxOutputBytes} bytes`));
          }
          total += chunk.length;
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
          if (chunk.length > maxInputBytes - total) {
            return cb(new Error(`[PipeX] Hashing input exceeds ${maxInputBytes} bytes`));
          }
          total += chunk.length;
          chunks.push(chunk);
          cb();
        },
        flush(cb) {
          const buffer = Buffer.concat(chunks, total);
          if (buffer.length < len) {
            return cb(new Error('[PipeX] Hashing stream: No HMAC found'));
          }
          const originalData = buffer.subarray(0, buffer.length - len);
          if (originalData.length > maxOutputBytes) {
            return cb(new Error(`[PipeX] Hashing output exceeds ${maxOutputBytes} bytes`));
          }
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
