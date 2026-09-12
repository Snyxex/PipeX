import type { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
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
  /** Temporarily accept the unversioned v3 format while migrating. Defaults to true. */
  allowLegacyDecrypt?: boolean;
}

/**
 * Authenticated, bounded-memory stream encryption.
 *
 * Version 4 writes the versioned PXAE framed format. The legacy unversioned
 * format remains readable by default for migration, but is never written.
 */
export class EncryptionPlugin extends BasePlugin {
  public readonly name = 'encryption';
  public readonly version = '4.0.0';

  constructor(protected override options: EncryptionOptions) {
    super(options);
    if (!options || !['aes-256-gcm', 'chacha20-poly1305'].includes(options.algorithm)
      || !Buffer.isBuffer(options.key) || options.key.length !== 32) {
      throw new Error('[PipeX] Encryption: invalid algorithm or key');
    }
    if (options.frameSizeBytes !== undefined
      && (!Number.isSafeInteger(options.frameSizeBytes)
        || options.frameSizeBytes < 1
        || options.frameSizeBytes > 0xffff_ffff)) {
      throw new Error('[PipeX] Encryption frameSizeBytes must be a positive 32-bit integer');
    }
    if (options.allowLegacyDecrypt !== undefined && typeof options.allowLegacyDecrypt !== 'boolean') {
      throw new Error('[PipeX] Encryption allowLegacyDecrypt must be a boolean');
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
