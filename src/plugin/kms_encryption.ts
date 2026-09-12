import { randomBytes, createCipheriv, createDecipheriv, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { BasePlugin } from '../core/plugin.js';
import { DEFAULT_LIMITS, pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { KmsOperation, KmsProviderCapabilities, ProcessorContext, KmsProvider } from '../core/types.js';
import {
  KmsAuthenticationError,
  KmsProviderAuthenticationError,
  KmsProviderError,
  KmsProviderUnavailableError,
  OperationAbortedError,
  OperationTimeoutError,
} from '../core/errors.js';
import { assertKmsOperation, getKmsProviderCapabilities } from '../core/kmsCapabilities.js';

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
const MAX_TIMER_MS = 0x7fff_ffff;

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
    void promise.then(value => {
      try { disposeLate?.(value); } catch { /* best-effort cleanup must not reject */ }
    }, () => undefined);
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
        if (aborted) {
          try { disposeLate?.(value); } catch { /* best-effort cleanup must not reject */ }
        }
        else resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

function providerControl(context: ProcessorContext): {
  signal: AbortSignal | undefined;
  cleanup(): void;
} {
  const timeoutMs = context.limits?.operationTimeoutMs ?? DEFAULT_LIMITS.operationTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMER_MS) {
    throw new Error('[PipeX] Invalid KMS provider timeout');
  }
  if (timeoutMs === 0) return { signal: context.signal, cleanup() {} };

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new DOMException('KMS provider operation timed out', 'TimeoutError'));
  }, timeoutMs);
  timer.unref();
  const signal = context.signal
    ? AbortSignal.any([context.signal, timeoutController.signal])
    : timeoutController.signal;
  return { signal, cleanup() { clearTimeout(timer); } };
}

function sanitizeProviderError(operation: KmsOperation, error: unknown): Error {
  if (error instanceof OperationAbortedError || error instanceof OperationTimeoutError) return error;
  if (error instanceof KmsProviderAuthenticationError) return new KmsProviderAuthenticationError(operation);
  if (error instanceof KmsProviderUnavailableError) return new KmsProviderUnavailableError(operation);
  return new KmsProviderError(operation);
}

async function callProvider<T>(
  provider: KmsProvider,
  operation: KmsOperation,
  context: ProcessorContext,
  invoke: (signal: AbortSignal | undefined) => Promise<T>,
  disposeLate?: (value: T) => void,
): Promise<T> {
  assertKmsOperation(provider, operation);
  const control = providerControl(context);
  try {
    if (control.signal?.aborted) throw abortError(control.signal);
    const promise = invoke(control.signal);
    return await abortable(promise, control.signal, disposeLate);
  } catch (error) {
    if (control.signal?.aborted) throw abortError(control.signal);
    throw sanitizeProviderError(operation, error);
  } finally {
    control.cleanup();
  }
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
  public readonly version = '2.1.0';
  public readonly streaming = false;

  public get providerCapabilities(): Readonly<KmsProviderCapabilities> {
    return getKmsProviderCapabilities(this.options.kms);
  }

  public override get reversible(): boolean {
    return this.providerCapabilities.decrypt;
  }

  constructor(protected override options: KmsEncryptionOptions) {
    super(options);
    if (!options || !options.kms || typeof options.keyId !== 'string' || options.keyId.length === 0) {
      throw new Error('[PipeX] KMS Encryption: invalid provider or keyId');
    }
    if (options.allowLegacyDecrypt !== undefined && typeof options.allowLegacyDecrypt !== 'boolean') {
      throw new Error('[PipeX] KMS Encryption allowLegacyDecrypt must be a boolean');
    }
    getKmsProviderCapabilities(options.kms);
    assertKmsOperation(options.kms, 'generateDataKey');
  }

  public override async process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> {
    const maxInputBytes = pluginInputLimit(ctx);
    const maxOutputBytes = pluginOutputLimit(ctx);
    const maxEncryptedKeyBytes = ctx.limits?.maxKmsEncryptedKeyBytes ?? DEFAULT_LIMITS.maxKmsEncryptedKeyBytes;
    const maxKeyIdBytes = ctx.limits?.maxKmsKeyIdBytes ?? DEFAULT_LIMITS.maxKmsKeyIdBytes;
    if (Buffer.byteLength(this.options.keyId) > maxKeyIdBytes) throw new Error('[PipeX] KMS key identifier exceeds the configured limit');
    if (data.length > maxInputBytes) throw new Error(`[PipeX] KMS encryption input exceeds ${maxInputBytes} bytes`);
    if (data.length > 0xffff_ffff) throw new Error('[PipeX] KMS encryption input exceeds the format limit');
    const minimumOverhead = FIXED_HEADER_LENGTH + 1 + TAG_LENGTH;
    if (data.length > maxOutputBytes - minimumOverhead) {
      throw new Error(`[PipeX] KMS encryption output exceeds ${maxOutputBytes} bytes`);
    }
    const { kms, keyId } = this.options;

    const keyResult = await callProvider(
      kms,
      'generateDataKey',
      ctx,
      signal => kms.generateDataKey!(keyId, { signal }),
      value => { if (Buffer.isBuffer(value?.plaintext)) value.plaintext.fill(0); },
    );

    const plaintext = keyResult?.plaintext;
    try {
      const encryptedKey = keyResult?.ciphertext;
      if (!Buffer.isBuffer(plaintext) || plaintext.length !== 32) throw new Error('[PipeX] KMS generated an invalid data key');
      if (!Buffer.isBuffer(encryptedKey) || encryptedKey.length < 1 || encryptedKey.length > maxEncryptedKeyBytes) {
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
    assertKmsOperation(kms, 'decrypt');
    const maxInputBytes = pluginInputLimit(ctx);
    const maxOutputBytes = pluginOutputLimit(ctx);
    const maxEncryptedKeyBytes = ctx.limits?.maxKmsEncryptedKeyBytes ?? DEFAULT_LIMITS.maxKmsEncryptedKeyBytes;
    const maxKeyIdBytes = ctx.limits?.maxKmsKeyIdBytes ?? DEFAULT_LIMITS.maxKmsKeyIdBytes;
    if (Buffer.byteLength(keyId) > maxKeyIdBytes) throw new Error('[PipeX] KMS key identifier exceeds the configured limit');
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
      if (keyLen < 1 || keyLen > maxEncryptedKeyBytes) throw new Error('[PipeX] KMS Decryption: invalid key envelope');
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
      if (keyLen < 1 || keyLen > maxEncryptedKeyBytes || data.length < 4 + keyLen + IV_LENGTH + TAG_LENGTH) {
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
    
    const plaintext = await callProvider(
      kms,
      'decrypt',
      ctx,
      signal => kms.decrypt!(encryptedKey, keyId, { signal }),
      value => { if (Buffer.isBuffer(value)) value.fill(0); },
    );

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
        throw new KmsAuthenticationError();
      }
    } finally {
      if (Buffer.isBuffer(plaintext)) plaintext.fill(0);
    }
  }
}
