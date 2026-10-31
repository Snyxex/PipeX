import type { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import { EncryptionError, InvalidKeyError } from '../core/errors.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';
import {
  createDecryptionStream,
  createEncryptionStream,
  decryptBuffer,
  encryptBuffer,
  type EncryptionFormatOptions,
} from './encryptionFormat.js';

export type { EncryptionAlgorithm } from './encryptionFormat.js';

export interface EncryptionOptions extends EncryptionFormatOptions {
  /** Maximum plaintext bytes in each authenticated frame. Defaults to 64 KiB. */
  frameSizeBytes?: number;
  /** Temporarily accept the unversioned v3 format while migrating. Defaults to false. */
  allowLegacyDecrypt?: boolean;
}

/**
 * Authenticated, bounded-memory stream encryption.
 *
 * Version 4 writes the versioned PXAE framed format. The legacy unversioned
 * format can be explicitly enabled for migration, but is never written.
 */
export class EncryptionPlugin extends BasePlugin {
  public readonly name = 'encryption';
  public readonly version = '4.0.0';

  constructor(protected override options: EncryptionOptions) {
    super(options);
    if (!options || !Buffer.isBuffer(options.key) || options.key.length !== 32) throw new InvalidKeyError();
    if (!['aes-256-gcm', 'chacha20-poly1305'].includes(options.algorithm)) throw new EncryptionError('[PipeX] Unsupported encryption algorithm');
    if (options.frameSizeBytes !== undefined
      && (!Number.isSafeInteger(options.frameSizeBytes)
        || options.frameSizeBytes < 1
        || options.frameSizeBytes > 0xffff_ffff)) {
      throw new EncryptionError('[PipeX] Invalid encryption frame size');
    }
    if (options.allowLegacyDecrypt !== undefined && typeof options.allowLegacyDecrypt !== 'boolean') {
      throw new EncryptionError('[PipeX] Invalid legacy decryption setting');
    }
  }

  public override async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    return encryptBuffer(data, this.options, context);
  }

  public override async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    return decryptBuffer(data, this.options, context);
  }

  public createStream(mode: 'compress' | 'decompress', context?: StreamPluginContext): Transform {
    return mode === 'compress'
      ? createEncryptionStream(this.options, context)
      : createDecryptionStream(this.options, context);
  }
}
