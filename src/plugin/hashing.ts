import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext } from '../core/types.js';

export type HashAlgorithm = 'sha256' | 'sha512';

interface HashOptions {
  algorithm: HashAlgorithm;
  secret: string;
}


const HASH_LENGTHS: Record<HashAlgorithm, number> = {
  'sha256': 32,
  'sha512': 64,
};

export class HashingPlugin extends BasePlugin {
  public readonly name = 'hashing-provider';
  public readonly version = '2.2.0';

  private readonly hashLength: number;

  constructor(protected override options: HashOptions) {
    super(options);
    if (!options.secret || options.secret.length < 16) {
      throw new Error(`[${this.name}] Secret must be at least 16 characters.`);
    }
    this.hashLength = HASH_LENGTHS[options.algorithm];
  }


  public override async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {

    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const hash = hmac.update(data).digest();

    context.metadata['final_hash'] = hash.toString('hex');

    return Buffer.concat([data, hash]);
  }

  public override async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {

    if (data.length < this.hashLength) {

      return data;
    }

    const originalData  = data.subarray(0, data.length - this.hashLength);
    const attachedHash  = data.subarray(data.length - this.hashLength);

    const expected = createHmac(this.options.algorithm, this.options.secret)
      .update(originalData)
      .digest();

    if (!timingSafeEqual(attachedHash, expected)) {
      throw new Error(
        `[${this.name}] Integrity check failed: HMAC does not match. ` +
        `Data may have been tampered with or the wrong key was used.`
      );
    }

    context.metadata['verified_hash'] = attachedHash.toString('hex');

    return originalData;
  }



  public createStream(mode?: 'compress' | 'decompress'): Transform {
    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const name = this.name;

    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hmac.update(chunk);
        callback(null, chunk); 
      },
      flush(callback) {
        const digest = hmac.digest();
        callback(null, digest);
      }
    });
  }
}




function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return cryptoTimingSafeEqual(a, b);
}