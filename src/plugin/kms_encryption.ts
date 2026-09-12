import { randomBytes, createCipheriv, createDecipheriv, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext, KmsProvider } from '../core/types.js';
import { KmsProviderError, OperationAbortedError, OperationTimeoutError } from '../core/errors.js';

export interface KmsEncryptionOptions {
  kms: KmsProvider;
  keyId: string;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

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
 * Packet format: [4B key_len][Encrypted Data Key][12B IV][16B Tag][Ciphertext]
 */
export class KmsEncryptionPlugin extends BasePlugin {
  public readonly name = 'kms-encryption';
  public readonly version = '1.0.0';
  public readonly streaming = false;

  constructor(protected override options: KmsEncryptionOptions) {
    super(options);
    if (!options.kms || typeof options.keyId !== 'string' || options.keyId.length === 0 || options.keyId.length > 512) {
      throw new Error('[PipeX] KMS Encryption: invalid provider or keyId');
    }
  }

  public override async process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const maxInputBytes = ctx.limits?.maxInputBytes ?? MAX_BUFFER_BYTES;
    const maxOutputBytes = ctx.limits?.maxOutputBytes ?? MAX_BUFFER_BYTES;
    if (data.length > maxInputBytes) throw new Error(`[PipeX] KMS encryption input exceeds ${maxInputBytes} bytes`);
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
      if (!Buffer.isBuffer(encryptedKey) || encryptedKey.length < 1 || encryptedKey.length > 64 * 1024) {
        throw new Error('[PipeX] KMS generated an invalid encrypted key');
      }
      const outputLength = 4 + encryptedKey.length + IV_LENGTH + TAG_LENGTH + data.length;
      if (outputLength > maxOutputBytes) throw new Error(`[PipeX] KMS encryption output exceeds ${maxOutputBytes} bytes`);

      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', plaintext, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const tag = cipher.getAuthTag();
      const keyLenBuf = Buffer.alloc(4);
      keyLenBuf.writeUInt32BE(encryptedKey.length);
      return Buffer.concat([keyLenBuf, encryptedKey, iv, tag, encrypted], outputLength);
    } finally {
      if (Buffer.isBuffer(plaintext)) plaintext.fill(0);
    }
  }

  public override async reverse(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const { kms, keyId } = this.options;
    const maxInputBytes = ctx.limits?.maxInputBytes ?? MAX_BUFFER_BYTES;
    const maxOutputBytes = ctx.limits?.maxOutputBytes ?? MAX_BUFFER_BYTES;
    if (data.length > maxInputBytes) throw new Error(`[PipeX] KMS decryption input exceeds ${maxInputBytes} bytes`);
    if (data.length < 4) throw new Error('[PipeX] KMS Decryption: Packet too short');
    
    const keyLen = data.readUInt32BE(0);
    if (keyLen < 1 || keyLen > 64 * 1024 || data.length < 4 + keyLen + IV_LENGTH + TAG_LENGTH) {
      throw new Error('[PipeX] KMS Decryption: invalid key envelope');
    }
    const encryptedKey = data.subarray(4, 4 + keyLen);
    const iv = data.subarray(4 + keyLen, 4 + keyLen + IV_LENGTH);
    const tag = data.subarray(4 + keyLen + IV_LENGTH, 4 + keyLen + IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(4 + keyLen + IV_LENGTH + TAG_LENGTH);
    
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
      decipher.setAuthTag(tag);
      const restored = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (restored.length > maxOutputBytes) throw new Error(`[PipeX] KMS decryption output exceeds ${maxOutputBytes} bytes`);
      return restored;
    } finally {
      if (Buffer.isBuffer(plaintext)) plaintext.fill(0);
    }
  }
}
