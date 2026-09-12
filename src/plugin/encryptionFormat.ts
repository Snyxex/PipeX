import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { DEFAULT_LIMITS, pluginInputLimit, pluginOutputLimit } from '../core/resourceLimits.js';
import type { ProcessorContext, StreamPluginContext } from '../core/types.js';

export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305';

export interface EncryptionFormatOptions {
  readonly algorithm: EncryptionAlgorithm;
  readonly key: Buffer;
  readonly frameSizeBytes?: number;
  readonly allowLegacyDecrypt?: boolean;
}

const MAGIC = Buffer.from('PXAE');
const VERSION = 1;
const GLOBAL_HEADER_LENGTH = 28;
const FRAME_HEADER_LENGTH = 13;
const TAG_LENGTH = 16;
const FRAME_OVERHEAD = FRAME_HEADER_LENGTH + TAG_LENGTH;
const DEFAULT_PLAINTEXT_FRAME_BYTES = 64 * 1024;
const DATA_FRAME = 1;
const FINAL_FRAME = 2;
const LEGACY_HEADER_LENGTH = 1 + 12 + TAG_LENGTH;

const ALGORITHM_IDS: Record<EncryptionAlgorithm, number> = {
  'aes-256-gcm': 1,
  'chacha20-poly1305': 2,
};
const ID_TO_ALGORITHM: Record<number, EncryptionAlgorithm> = {
  1: 'aes-256-gcm',
  2: 'chacha20-poly1305',
};

interface FormatLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxFrameBytes: number;
  readonly maxFrames: number;
}

interface ParsedHeader {
  readonly bytes: Buffer;
  readonly algorithm: EncryptionAlgorithm;
  readonly frameSizeBytes: number;
  readonly salt: Buffer;
}

function limitsFor(context?: ProcessorContext | StreamPluginContext): FormatLimits {
  return {
    maxInputBytes: pluginInputLimit(context),
    maxOutputBytes: pluginOutputLimit(context),
    maxFrameBytes: context?.limits?.maxFrameBytes ?? DEFAULT_LIMITS.maxFrameBytes,
    maxFrames: context?.limits?.maxFrames ?? DEFAULT_LIMITS.maxFrames,
  };
}

function resolveFrameSize(options: EncryptionFormatOptions, limits: FormatLimits): number {
  const capacity = limits.maxFrameBytes - FRAME_OVERHEAD;
  if (capacity < 1 || limits.maxFrameBytes < GLOBAL_HEADER_LENGTH) {
    throw new Error(`[PipeX] Encryption frame limit ${limits.maxFrameBytes} bytes is too small`);
  }
  const requested = options.frameSizeBytes ?? Math.min(DEFAULT_PLAINTEXT_FRAME_BYTES, capacity);
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 0xffff_ffff) {
    throw new Error('[PipeX] Encryption frameSizeBytes must be a positive 32-bit integer');
  }
  if (requested > capacity) {
    throw new Error(`[PipeX] Encryption frameSizeBytes exceeds the ${limits.maxFrameBytes}-byte frame limit`);
  }
  return requested;
}

function encodedLength(plaintextBytes: number, frameSizeBytes: number): number {
  const dataFrames = plaintextBytes === 0 ? 0 : Math.ceil(plaintextBytes / frameSizeBytes);
  return GLOBAL_HEADER_LENGTH + plaintextBytes + (dataFrames + 1) * FRAME_OVERHEAD;
}

function dataFrameCount(plaintextBytes: number, frameSizeBytes: number): number {
  return plaintextBytes === 0 ? 0 : Math.ceil(plaintextBytes / frameSizeBytes);
}

function buildHeader(algorithm: EncryptionAlgorithm, frameSizeBytes: number, salt = randomBytes(16)): Buffer {
  const header = Buffer.alloc(GLOBAL_HEADER_LENGTH);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, 4);
  header.writeUInt8(ALGORITHM_IDS[algorithm], 5);
  header.writeUInt16BE(0, 6);
  header.writeUInt32BE(frameSizeBytes, 8);
  salt.copy(header, 12);
  return header;
}

function parseHeader(header: Buffer, limits: FormatLimits): ParsedHeader {
  if (header.length !== GLOBAL_HEADER_LENGTH || !header.subarray(0, 4).equals(MAGIC)) {
    throw new Error('[PipeX] Decryption failed: invalid framed header');
  }
  if (header.readUInt8(4) !== VERSION) throw new Error('[PipeX] Decryption failed: unsupported format version');
  const algorithm = ID_TO_ALGORITHM[header.readUInt8(5)];
  if (!algorithm || header.readUInt16BE(6) !== 0) throw new Error('[PipeX] Decryption failed: invalid framed header');
  const frameSizeBytes = header.readUInt32BE(8);
  if (frameSizeBytes < 1 || frameSizeBytes > limits.maxFrameBytes - FRAME_OVERHEAD) {
    throw new Error('[PipeX] Decryption failed: invalid frame size');
  }
  return { bytes: header, algorithm, frameSizeBytes, salt: header.subarray(12, 28) };
}

function deriveKey(key: Buffer, header: ParsedHeader): Buffer {
  const info = Buffer.from(`PipeX AEAD framed v${VERSION}:${header.algorithm}`, 'utf8');
  return Buffer.from(hkdfSync('sha256', key, header.salt, info, 32));
}

function nonceFor(sequence: bigint): Buffer {
  if (sequence < 0n || sequence > 0xffff_ffff_ffff_ffffn) {
    throw new Error('[PipeX] Encryption frame sequence exhausted');
  }
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(sequence, 4);
  return nonce;
}

function buildFrameHeader(type: number, sequence: bigint, ciphertextBytes: number): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_LENGTH);
  header.writeUInt8(type, 0);
  header.writeBigUInt64BE(sequence, 1);
  header.writeUInt32BE(ciphertextBytes, 9);
  return header;
}

function encryptFrame(
  plaintext: Buffer,
  type: number,
  sequence: bigint,
  algorithm: EncryptionAlgorithm,
  key: Buffer,
  globalHeader: Buffer,
): Buffer {
  const frameHeader = buildFrameHeader(type, sequence, plaintext.length);
  const nonce = nonceFor(sequence);
  try {
    const cipher = createCipheriv(algorithm, key, nonce, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
    cipher.setAAD(Buffer.concat([globalHeader, frameHeader]));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([frameHeader, ciphertext, cipher.getAuthTag()], FRAME_OVERHEAD + ciphertext.length);
  } finally {
    nonce.fill(0);
  }
}

function decryptFrame(
  ciphertext: Buffer,
  tag: Buffer,
  frameHeader: Buffer,
  sequence: bigint,
  algorithm: EncryptionAlgorithm,
  key: Buffer,
  globalHeader: Buffer,
): Buffer {
  const nonce = nonceFor(sequence);
  const decipher = createDecipheriv(algorithm, key, nonce, { authTagLength: TAG_LENGTH } as any) as DecipherGCM;
  decipher.setAAD(Buffer.concat([globalHeader, frameHeader]));
  decipher.setAuthTag(tag);
  const pending = decipher.update(ciphertext);
  try {
    const final = decipher.final();
    return final.length === 0 ? pending : Buffer.concat([pending, final]);
  } catch {
    pending.fill(0);
    throw new Error('[PipeX] Decryption failed: authentication failed');
  } finally {
    nonce.fill(0);
  }
}

function decryptLegacy(data: Buffer, key: Buffer, limits: FormatLimits): Buffer {
  if (data.length < LEGACY_HEADER_LENGTH) throw new Error('[PipeX] Decryption failed: packet too short');
  if (data.length - LEGACY_HEADER_LENGTH > limits.maxOutputBytes) {
    throw new Error(`[PipeX] Decryption output exceeds ${limits.maxOutputBytes} bytes`);
  }
  const algorithm = ID_TO_ALGORITHM[data.readUInt8(0)];
  if (!algorithm) throw new Error('[PipeX] Decryption failed: unknown legacy algorithm');
  const decipher = createDecipheriv(algorithm, key, data.subarray(1, 13), { authTagLength: TAG_LENGTH } as any) as DecipherGCM;
  decipher.setAuthTag(data.subarray(13, LEGACY_HEADER_LENGTH));
  const pending = decipher.update(data.subarray(LEGACY_HEADER_LENGTH));
  try {
    const final = decipher.final();
    return final.length === 0 ? pending : Buffer.concat([pending, final]);
  } catch {
    pending.fill(0);
    throw new Error('[PipeX] Decryption failed: authentication failed');
  }
}

export function isFramedEncryption(data: Buffer): boolean {
  return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBuffer(data: Buffer, options: EncryptionFormatOptions, context?: ProcessorContext): Buffer {
  const limits = limitsFor(context);
  if (data.length > limits.maxInputBytes) throw new Error(`[PipeX] Encryption input exceeds ${limits.maxInputBytes} bytes`);
  const frameSizeBytes = resolveFrameSize(options, limits);
  if (dataFrameCount(data.length, frameSizeBytes) > limits.maxFrames) {
    throw new Error(`[PipeX] Encryption frame count exceeds ${limits.maxFrames}`);
  }
  const outputLength = encodedLength(data.length, frameSizeBytes);
  if (outputLength > limits.maxOutputBytes) throw new Error(`[PipeX] Encryption output exceeds ${limits.maxOutputBytes} bytes`);
  const header = buildHeader(options.algorithm, frameSizeBytes);
  const parsed = parseHeader(header, limits);
  const derivedKey = deriveKey(options.key, parsed);
  const frames: Buffer[] = [header];
  let sequence = 0n;
  try {
    for (let offset = 0; offset < data.length; offset += frameSizeBytes) {
      frames.push(encryptFrame(data.subarray(offset, Math.min(data.length, offset + frameSizeBytes)), DATA_FRAME, sequence++, options.algorithm, derivedKey, header));
    }
    frames.push(encryptFrame(Buffer.alloc(0), FINAL_FRAME, sequence, options.algorithm, derivedKey, header));
    return Buffer.concat(frames, outputLength);
  } finally {
    derivedKey.fill(0);
  }
}

export function decryptBuffer(data: Buffer, options: EncryptionFormatOptions, context?: ProcessorContext): Buffer {
  const limits = limitsFor(context);
  if (data.length > limits.maxInputBytes) throw new Error(`[PipeX] Decryption input exceeds ${limits.maxInputBytes} bytes`);
  // Legacy packets always start with algorithm id 1 or 2. Reserve the magic
  // prefix byte so truncated framed packets cannot be misclassified as legacy.
  if (data.length === 0 || (!isFramedEncryption(data) && data.readUInt8(0) !== MAGIC.readUInt8(0))) {
    if (options.allowLegacyDecrypt === false) throw new Error('[PipeX] Decryption failed: legacy format disabled');
    return decryptLegacy(data, options.key, limits);
  }
  if (data.length < GLOBAL_HEADER_LENGTH) throw new Error('[PipeX] Decryption failed: incomplete framed header');
  const header = parseHeader(data.subarray(0, GLOBAL_HEADER_LENGTH), limits);
  const derivedKey = deriveKey(options.key, header);
  const plaintext: Buffer[] = [];
  let plaintextBytes = 0;
  let position = GLOBAL_HEADER_LENGTH;
  let expectedSequence = 0n;
  let dataFrames = 0;
  let finalSeen = false;
  try {
    while (position < data.length) {
      if (finalSeen || data.length - position < FRAME_HEADER_LENGTH) throw new Error('[PipeX] Decryption failed: incomplete or trailing frame');
      const frameHeader = data.subarray(position, position + FRAME_HEADER_LENGTH);
      position += FRAME_HEADER_LENGTH;
      const type = frameHeader.readUInt8(0);
      const sequence = frameHeader.readBigUInt64BE(1);
      const ciphertextBytes = frameHeader.readUInt32BE(9);
      if (sequence !== expectedSequence) throw new Error('[PipeX] Decryption failed: invalid frame sequence');
      if (type !== DATA_FRAME && type !== FINAL_FRAME) throw new Error('[PipeX] Decryption failed: invalid frame type');
      if (type === FINAL_FRAME && ciphertextBytes !== 0) throw new Error('[PipeX] Decryption failed: invalid final frame');
      if (ciphertextBytes > header.frameSizeBytes || ciphertextBytes > limits.maxFrameBytes - FRAME_OVERHEAD) throw new Error('[PipeX] Decryption failed: frame length exceeds configured limit');
      if (type === DATA_FRAME && dataFrames >= limits.maxFrames) throw new Error(`[PipeX] Encryption frame count exceeds ${limits.maxFrames}`);
      if (type === DATA_FRAME && ciphertextBytes > limits.maxOutputBytes - plaintextBytes) {
        throw new Error(`[PipeX] Decryption output exceeds ${limits.maxOutputBytes} bytes`);
      }
      if (data.length - position < ciphertextBytes + TAG_LENGTH) throw new Error('[PipeX] Decryption failed: incomplete frame');
      const ciphertext = data.subarray(position, position + ciphertextBytes);
      position += ciphertextBytes;
      const tag = data.subarray(position, position + TAG_LENGTH);
      position += TAG_LENGTH;
      const restored = decryptFrame(ciphertext, tag, frameHeader, sequence, header.algorithm, derivedKey, header.bytes);
      if (type === FINAL_FRAME) {
        restored.fill(0);
        finalSeen = true;
      } else {
        dataFrames++;
        plaintextBytes += restored.length;
        plaintext.push(restored);
      }
      expectedSequence++;
    }
    if (!finalSeen) throw new Error('[PipeX] Decryption failed: missing authenticated final frame');
    const result = Buffer.concat(plaintext, plaintextBytes);
    for (const chunk of plaintext) chunk.fill(0);
    return result;
  } catch (error) {
    for (const chunk of plaintext) chunk.fill(0);
    throw error;
  } finally {
    derivedKey.fill(0);
  }
}

export function createEncryptionStream(options: EncryptionFormatOptions, context?: StreamPluginContext): Transform {
  const limits = limitsFor(context);
  const frameSizeBytes = resolveFrameSize(options, limits);
  if (encodedLength(0, frameSizeBytes) > limits.maxOutputBytes) throw new Error(`[PipeX] Encryption output exceeds ${limits.maxOutputBytes} bytes`);
  const header = buildHeader(options.algorithm, frameSizeBytes);
  const parsed = parseHeader(header, limits);
  const derivedKey = deriveKey(options.key, parsed);
  let pending = Buffer.alloc(frameSizeBytes);
  let pendingBytes = 0;
  let inputBytes = 0;
  let dataFrames = 0;
  let sequence = 0n;
  let headerSent = false;
  const cleanup = () => { pending.fill(0); derivedKey.fill(0); };

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (input.length > limits.maxInputBytes - inputBytes) throw new Error(`[PipeX] Encryption input exceeds ${limits.maxInputBytes} bytes`);
        const prospectiveInput = inputBytes + input.length;
        if (dataFrameCount(prospectiveInput, frameSizeBytes) > limits.maxFrames) {
          throw new Error(`[PipeX] Encryption frame count exceeds ${limits.maxFrames}`);
        }
        if (encodedLength(prospectiveInput, frameSizeBytes) > limits.maxOutputBytes) throw new Error(`[PipeX] Encryption output exceeds ${limits.maxOutputBytes} bytes`);
        inputBytes = prospectiveInput;
        if (!headerSent) { this.push(header); headerSent = true; }
        let offset = 0;
        while (offset < input.length) {
          const copied = Math.min(frameSizeBytes - pendingBytes, input.length - offset);
          input.copy(pending, pendingBytes, offset, offset + copied);
          pendingBytes += copied;
          offset += copied;
          if (pendingBytes === frameSizeBytes) {
            if (++dataFrames > limits.maxFrames) throw new Error(`[PipeX] Encryption frame count exceeds ${limits.maxFrames}`);
            this.push(encryptFrame(pending, DATA_FRAME, sequence++, options.algorithm, derivedKey, header));
            pending.fill(0);
            pendingBytes = 0;
          }
        }
        callback();
      } catch (error) {
        cleanup();
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!headerSent) { this.push(header); headerSent = true; }
        if (pendingBytes > 0) {
          if (++dataFrames > limits.maxFrames) throw new Error(`[PipeX] Encryption frame count exceeds ${limits.maxFrames}`);
          this.push(encryptFrame(pending.subarray(0, pendingBytes), DATA_FRAME, sequence++, options.algorithm, derivedKey, header));
        }
        this.push(encryptFrame(Buffer.alloc(0), FINAL_FRAME, sequence, options.algorithm, derivedKey, header));
        cleanup();
        callback();
      } catch (error) {
        cleanup();
        callback(error as Error);
      }
    },
    destroy(error, callback) { cleanup(); callback(error); },
  });
}

export function createDecryptionStream(options: EncryptionFormatOptions, context?: StreamPluginContext): Transform {
  const limits = limitsFor(context);
  let format: 'unknown' | 'framed' | 'legacy' = 'unknown';
  let totalInput = 0;
  let totalOutput = 0;
  const globalHeader = Buffer.alloc(GLOBAL_HEADER_LENGTH);
  let globalHeaderBytes = 0;
  let parsedHeader: ParsedHeader | undefined;
  let derivedKey: Buffer | undefined;
  const frameHeader = Buffer.alloc(FRAME_HEADER_LENGTH);
  let frameHeaderBytes = 0;
  let frameBody: Buffer | undefined;
  let frameBodyBytes = 0;
  let expectedSequence = 0n;
  let dataFrames = 0;
  let finalSeen = false;
  let legacyChunks: Buffer[] = [];
  const cleanup = () => {
    derivedKey?.fill(0);
    frameBody?.fill(0);
    globalHeader.fill(0);
    frameHeader.fill(0);
    legacyChunks = [];
  };

  const consumeFramed = (input: Buffer, stream: Transform): void => {
    let offset = 0;
    while (offset < input.length) {
      if (finalSeen) throw new Error('[PipeX] Decryption failed: trailing data after final frame');
      if (!parsedHeader) {
        const copied = Math.min(GLOBAL_HEADER_LENGTH - globalHeaderBytes, input.length - offset);
        input.copy(globalHeader, globalHeaderBytes, offset, offset + copied);
        globalHeaderBytes += copied;
        offset += copied;
        if (globalHeaderBytes === GLOBAL_HEADER_LENGTH) {
          parsedHeader = parseHeader(globalHeader, limits);
          derivedKey = deriveKey(options.key, parsedHeader);
        }
        continue;
      }
      if (frameHeaderBytes < FRAME_HEADER_LENGTH) {
        const copied = Math.min(FRAME_HEADER_LENGTH - frameHeaderBytes, input.length - offset);
        input.copy(frameHeader, frameHeaderBytes, offset, offset + copied);
        frameHeaderBytes += copied;
        offset += copied;
        if (frameHeaderBytes < FRAME_HEADER_LENGTH) continue;
        const type = frameHeader.readUInt8(0);
        const sequence = frameHeader.readBigUInt64BE(1);
        const ciphertextBytes = frameHeader.readUInt32BE(9);
        if (sequence !== expectedSequence) throw new Error('[PipeX] Decryption failed: invalid frame sequence');
        if (type !== DATA_FRAME && type !== FINAL_FRAME) throw new Error('[PipeX] Decryption failed: invalid frame type');
        if (type === FINAL_FRAME && ciphertextBytes !== 0) throw new Error('[PipeX] Decryption failed: invalid final frame');
        if (ciphertextBytes > parsedHeader.frameSizeBytes || ciphertextBytes > limits.maxFrameBytes - FRAME_OVERHEAD) throw new Error('[PipeX] Decryption failed: frame length exceeds configured limit');
        if (type === DATA_FRAME && dataFrames >= limits.maxFrames) throw new Error(`[PipeX] Encryption frame count exceeds ${limits.maxFrames}`);
        if (type === DATA_FRAME && ciphertextBytes > limits.maxOutputBytes - totalOutput) {
          throw new Error(`[PipeX] Decryption output exceeds ${limits.maxOutputBytes} bytes`);
        }
        frameBody = Buffer.alloc(ciphertextBytes + TAG_LENGTH);
        frameBodyBytes = 0;
      }
      const copied = Math.min(frameBody!.length - frameBodyBytes, input.length - offset);
      input.copy(frameBody!, frameBodyBytes, offset, offset + copied);
      frameBodyBytes += copied;
      offset += copied;
      if (frameBodyBytes < frameBody!.length) continue;
      const type = frameHeader.readUInt8(0);
      const sequence = frameHeader.readBigUInt64BE(1);
      const ciphertextBytes = frameHeader.readUInt32BE(9);
      const restored = decryptFrame(frameBody!.subarray(0, ciphertextBytes), frameBody!.subarray(ciphertextBytes), frameHeader, sequence, parsedHeader.algorithm, derivedKey!, parsedHeader.bytes);
      if (type === FINAL_FRAME) {
        restored.fill(0);
        finalSeen = true;
      } else {
        dataFrames++;
        totalOutput += restored.length;
        stream.push(restored);
      }
      expectedSequence++;
      frameBody!.fill(0);
      frameBody = undefined;
      frameBodyBytes = 0;
      frameHeader.fill(0);
      frameHeaderBytes = 0;
    }
  };

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (input.length > limits.maxInputBytes - totalInput) throw new Error(`[PipeX] Decryption input exceeds ${limits.maxInputBytes} bytes`);
        totalInput += input.length;
        if (input.length === 0) return callback();
        if (format === 'unknown') {
          format = input.readUInt8(0) === MAGIC.readUInt8(0) ? 'framed' : 'legacy';
          if (format === 'legacy' && options.allowLegacyDecrypt === false) throw new Error('[PipeX] Decryption failed: legacy format disabled');
        }
        if (format === 'legacy') legacyChunks.push(input);
        else consumeFramed(input, this);
        callback();
      } catch (error) {
        cleanup();
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (format === 'legacy') {
          const restored = decryptLegacy(Buffer.concat(legacyChunks, totalInput), options.key, limits);
          this.push(restored);
          cleanup();
          return callback();
        }
        if (format !== 'framed' || !parsedHeader || frameHeaderBytes !== 0 || frameBody) throw new Error('[PipeX] Decryption failed: incomplete encrypted stream');
        if (!finalSeen) throw new Error('[PipeX] Decryption failed: missing authenticated final frame');
        cleanup();
        callback();
      } catch (error) {
        cleanup();
        callback(error as Error);
      }
    },
    destroy(error, callback) { cleanup(); callback(error); },
  });
}
