import type { Transform } from 'node:stream';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';
import {
  createDecryptionStream,
  createEncryptionStream,
  decryptBuffer,
  encryptBuffer,
} from './encryptionFormat.js';

export type { EncryptionAlgorithm } from './encryptionFormat.js';

/** Shared authenticated-encryption settings. */
export interface EncryptionCommonOptions {
  /** Secret 32-byte encryption key; length is enforced at runtime. */
  readonly key: Buffer;
  /** Maximum plaintext bytes per authenticated frame (default 64 KiB). */
  readonly frameSizeBytes?: number;
  /** Allow reading old records only during an explicit migration. */
  readonly allowLegacyDecrypt?: boolean;
}
/** AES-256-GCM configuration. */
export interface Aes256GcmOptions extends EncryptionCommonOptions {
  readonly algorithm: 'aes-256-gcm';
}
/** ChaCha20-Poly1305 configuration. */
export interface ChaCha20Poly1305Options extends EncryptionCommonOptions {
  readonly algorithm: 'chacha20-poly1305';
}
/** Algorithm-discriminated encryption settings. */
export type EncryptionOptions = Aes256GcmOptions | ChaCha20Poly1305Options;

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
