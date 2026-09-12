import { randomBytes, createCipheriv, createDecipheriv, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { BasePlugin } from '../core/plugin.js';
import { pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { ProcessorContext, KmsProvider } from '../core/types.js';
import { KmsProviderError, OperationAbortedError, OperationTimeoutError } from '../core/errors.js';

export interface KmsEncryptionOptions {
  kms: KmsProvider;
  keyId: string;
  /** Temporarily accept the unversioned v1 envelope while migrating. Defaults to true. */
  allowLegacyDecrypt?: boolean;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAGIC = Buffer.from('PXKM');
const FORMAT_VERSION = 1;
const ALGORITHM_AES_256_GCM = 1;
const FIXED_HEADER_LENGTH = 4 + 1 + 1 + 2 + 4 + 4 + IV_LENGTH;
const MAX_ENCRYPTED_KEY_BYTES = 64 * 1024;

function abortError(signal: AbortSignal): OperationAbortedError | OperationTimeoutError {
  const options = { cause: signal.reason };
  return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? new OperationTimeoutError(options)
    : new OperationAbortedError(options);
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  disposeLate?: (value: T) => void,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.then(value => disposeLate?.(value), () => undefined);
    throw abortError(signal);
  }
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        if (aborted) disposeLate?.(value);
        else resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

/**
 * KmsEncryptionPlugin — Enterprise-grade encryption using Envelope Encryption.
 * 
 * 1. Generate a data key via KMS.
 * 2. Encrypt data locally using the plaintext data key.
 * 3. Prepend the encrypted data key (ciphertext) to the payload.
 * 
 * Packet format: [PXKM][version][algorithm][flags][key_len][ciphertext_len]
 *                [12B IV][Encrypted Data Key][Ciphertext][16B Tag]
 */
export class KmsEncryptionPlugin extends BasePlugin {
  public readonly name = 'kms-encryption';
  public readonly version = '2.0.0';
  public readonly streaming = false;

  constructor(protected override options: KmsEncryptionOptions) {
    super(options);
    if (!options.kms || typeof options.keyId !== 'string' || options.keyId.length === 0 || options.keyId.length > 512) {
      throw new Error('[PipeX] KMS Encryption: invalid provider or keyId');
    }
    if (options.allowLegacyDecrypt !== undefined && typeof options.allowLegacyDecrypt !== 'boolean') {
      throw new Error('[PipeX] KMS Encryption allowLegacyDecrypt must be a boolean');
    }
  }

  public override async process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const maxInputBytes = pluginInputLimit(ctx);
    const maxOutputBytes = pluginOutputLimit(ctx);
    if (data.length > maxInputBytes) throw new Error(`[PipeX] KMS encryption input exceeds ${maxInputBytes} bytes`);
    if (data.length > 0xffff_ffff) throw new Error('[PipeX] KMS encryption input exceeds the format limit');
    const minimumOverhead = FIXED_HEADER_LENGTH + 1 + TAG_LENGTH;
    if (data.length > maxOutputBytes - minimumOverhead) {
      throw new Error(`[PipeX] KMS encryption output exceeds ${maxOutputBytes} bytes`);
    }
    const { kms, keyId } = this.options;

    let keyResult: { plaintext: Buffer; ciphertext: Buffer };
    try {
      keyResult = await abortable(
        kms.generateDataKey(keyId, { signal: ctx.signal }),
        ctx.signal,
        value => { if (Buffer.isBuffer(value?.plaintext)) value.plaintext.fill(0); },
      );
    } catch (error) {
      if (error instanceof OperationAbortedError || error instanceof OperationTimeoutError) throw error;
      throw new KmsProviderError('generateDataKey', { cause: error });
    }

    const { plaintext, ciphertext: encryptedKey } = keyResult;
    try {
      if (!Buffer.isBuffer(plaintext) || plaintext.length !== 32) throw new Error('[PipeX] KMS generated an invalid data key');
      if (!Buffer.isBuffer(encryptedKey) || encryptedKey.length < 1 || encryptedKey.length > MAX_ENCRYPTED_KEY_BYTES) {
        throw new Error('[PipeX] KMS generated an invalid encrypted key');
      }
      const overhead = FIXED_HEADER_LENGTH + encryptedKey.length + TAG_LENGTH;
      if (data.length > maxOutputBytes - overhead) {
        throw new Error(`[PipeX] KMS encryption output exceeds ${maxOutputBytes} bytes`);
      }
      const outputLength = overhead + data.length;

      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', plaintext, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
      const header = Buffer.alloc(FIXED_HEADER_LENGTH);
      MAGIC.copy(header, 0);
      header.writeUInt8(FORMAT_VERSION, 4);
      header.writeUInt8(ALGORITHM_AES_256_GCM, 5);
      header.writeUInt16BE(0, 6);
      header.writeUInt32BE(encryptedKey.length, 8);
      header.writeUInt32BE(data.length, 12);
      iv.copy(header, 16);
      cipher.setAAD(Buffer.concat([header, encryptedKey]));
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([header, encryptedKey, encrypted, tag], outputLength);
    } finally {
      if (Buffer.isBuffer(plaintext)) plaintext.fill(0);
    }
  }

  public override async reverse(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const { kms, keyId } = this.options;
    const maxInputBytes = pluginInputLimit(ctx);
    const maxOutputBytes = pluginOutputLimit(ctx);
    if (data.length > maxInputBytes) throw new Error(`[PipeX] KMS decryption input exceeds ${maxInputBytes} bytes`);
    if (data.length === 0) throw new Error('[PipeX] KMS Decryption: Packet too short');

    const framed = data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC);
    if (!framed && data.readUInt8(0) === MAGIC.readUInt8(0)) {
      throw new Error('[PipeX] KMS Decryption: incomplete framed header');
    }
    if (!framed && this.options.allowLegacyDecrypt === false) {
      throw new Error('[PipeX] KMS Decryption: legacy format disabled');
    }

    let encryptedKey: Buffer;
    let iv: Buffer;
    let tag: Buffer;
    let ciphertext: Buffer;
    let authenticatedHeader: Buffer | undefined;
    if (framed) {
      if (data.length < FIXED_HEADER_LENGTH + 1 + TAG_LENGTH) throw new Error('[PipeX] KMS Decryption: incomplete framed envelope');
      if (data.readUInt8(4) !== FORMAT_VERSION) throw new Error('[PipeX] KMS Decryption: unsupported format version');
      if (data.readUInt8(5) !== ALGORITHM_AES_256_GCM || data.readUInt16BE(6) !== 0) {
        throw new Error('[PipeX] KMS Decryption: invalid framed envelope');
      }
      const keyLen = data.readUInt32BE(8);
      const ciphertextLength = data.readUInt32BE(12);
      if (keyLen < 1 || keyLen > MAX_ENCRYPTED_KEY_BYTES) throw new Error('[PipeX] KMS Decryption: invalid key envelope');
      const expectedLength = FIXED_HEADER_LENGTH + keyLen + ciphertextLength + TAG_LENGTH;
      if (expectedLength !== data.length) throw new Error('[PipeX] KMS Decryption: invalid envelope length');
      if (ciphertextLength > maxOutputBytes) throw new Error(`[PipeX] KMS decryption output exceeds ${maxOutputBytes} bytes`);
      iv = data.subarray(16, FIXED_HEADER_LENGTH);
      encryptedKey = data.subarray(FIXED_HEADER_LENGTH, FIXED_HEADER_LENGTH + keyLen);
      ciphertext = data.subarray(FIXED_HEADER_LENGTH + keyLen, data.length - TAG_LENGTH);
      tag = data.subarray(data.length - TAG_LENGTH);
      authenticatedHeader = data.subarray(0, FIXED_HEADER_LENGTH + keyLen);
    } else {
      if (data.length < 4) throw new Error('[PipeX] KMS Decryption: Packet too short');
      const keyLen = data.readUInt32BE(0);
      if (keyLen < 1 || keyLen > MAX_ENCRYPTED_KEY_BYTES || data.length < 4 + keyLen + IV_LENGTH + TAG_LENGTH) {
        throw new Error('[PipeX] KMS Decryption: invalid key envelope');
      }
      encryptedKey = data.subarray(4, 4 + keyLen);
      iv = data.subarray(4 + keyLen, 4 + keyLen + IV_LENGTH);
      tag = data.subarray(4 + keyLen + IV_LENGTH, 4 + keyLen + IV_LENGTH + TAG_LENGTH);
      ciphertext = data.subarray(4 + keyLen + IV_LENGTH + TAG_LENGTH);
    }
    if (ciphertext.length > maxOutputBytes) {
      throw new Error(`[PipeX] KMS decryption output exceeds ${maxOutputBytes} bytes`);
    }
    
    let plaintext: Buffer;
    try {
      plaintext = await abortable(
        kms.decrypt(encryptedKey, keyId, { signal: ctx.signal }),
        ctx.signal,
        value => { if (Buffer.isBuffer(value)) value.fill(0); },
      );
    } catch (error) {
      if (error instanceof OperationAbortedError || error instanceof OperationTimeoutError) throw error;
      throw new KmsProviderError('decrypt', { cause: error });
    }

    try {
      if (!Buffer.isBuffer(plaintext) || plaintext.length !== 32) throw new Error('[PipeX] KMS Decryption: invalid data key length');
      const decipher = createDecipheriv('aes-256-gcm', plaintext, iv, { authTagLength: TAG_LENGTH } as any) as DecipherGCM;
      if (authenticatedHeader) decipher.setAAD(authenticatedHeader);
      decipher.setAuthTag(tag);
      const pending = decipher.update(ciphertext);
      try {
        const final = decipher.final();
        return final.length === 0 ? pending : Buffer.concat([pending, final]);
      } catch {
        pending.fill(0);
        throw new Error('[PipeX] KMS Decryption: authentication failed');
      }
    } finally {
      if (Buffer.isBuffer(plaintext)) plaintext.fill(0);
    }
  }
}
