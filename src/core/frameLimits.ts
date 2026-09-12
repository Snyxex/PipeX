import { Transform, type TransformCallback } from 'node:stream';

type LengthKind = 'array' | 'map' | 'payload' | 'extension';

interface PendingLength {
  readonly kind: LengthKind;
  readonly bytes: number;
  read: number;
  value: number;
}

/**
 * Incremental MessagePack structural scanner. It finds top-level frame
 * boundaries without decoding values and rejects impossible oversized frames
 * as soon as their length header is complete.
 */
class MessagePackFrameScanner {
  readonly #maxFrameBytes: number;
  readonly #maxFrames: number;
  #frameBytes = 0;
  #remainingValues = 1;
  #payloadBytes = 0;
  #extensionTypePending = false;
  #pending?: PendingLength;
  #frames = 0;

  constructor(maxFrameBytes: number, maxFrames: number) {
    this.#maxFrameBytes = maxFrameBytes;
    this.#maxFrames = maxFrames;
  }

  scan(chunk: Buffer): number[] {
    const boundaries: number[] = [];
    let offset = 0;

    while (offset < chunk.length) {
      if (this.#payloadBytes > 0) {
        if (this.#extensionTypePending) {
          this.#consumeBytes(1);
          const extensionType = chunk[offset]!;
          offset++;
          this.#payloadBytes--;
          this.#extensionTypePending = false;
          // msgpackr record and bundled-string extensions change how following
          // bytes are parsed, so they are excluded from the bounded wire format.
          if (extensionType === 0x62 || extensionType === 0x72) this.#invalidInput();
          if (this.#payloadBytes === 0) this.#completeIfReady(offset, boundaries);
          continue;
        }
        const consumed = Math.min(this.#payloadBytes, chunk.length - offset);
        this.#consumeBytes(consumed);
        this.#payloadBytes -= consumed;
        offset += consumed;
        if (this.#payloadBytes > 0 && this.#frameBytes === this.#maxFrameBytes) this.#frameTooLarge();
        if (this.#payloadBytes === 0) this.#completeIfReady(offset, boundaries);
        continue;
      }

      if (this.#pending) {
        const pending = this.#pending;
        this.#consumeBytes(1);
        pending.value = pending.value * 256 + chunk[offset]!;
        offset++;
        pending.read++;
        if (pending.read === pending.bytes) {
          const { kind, value } = pending;
          this.#pending = undefined;
          this.#applyLength(kind, value);
          this.#completeIfReady(offset, boundaries);
        }
        continue;
      }

      this.#consumeBytes(1);
      const token = chunk[offset]!;
      offset++;
      this.#remainingValues--;
      if (this.#remainingValues < 0) this.#invalidInput();
      this.#readToken(token);
      this.#completeIfReady(offset, boundaries);
    }

    return boundaries;
  }

  finish(): void {
    if (this.#frameBytes !== 0 || this.#pending || this.#payloadBytes !== 0) {
      throw new Error('[PipeX] Invalid MessagePack input: incomplete frame');
    }
  }

  #consumeBytes(count: number): void {
    if (count > this.#maxFrameBytes - this.#frameBytes) this.#frameTooLarge();
    this.#frameBytes += count;
  }

  #ensureMinimumRemaining(additionalBytes = 0): void {
    const capacity = this.#maxFrameBytes - this.#frameBytes;
    if (additionalBytes > capacity || this.#remainingValues > capacity - additionalBytes) {
      this.#frameTooLarge();
    }
  }

  #addChildren(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0
      || count > Number.MAX_SAFE_INTEGER - this.#remainingValues) this.#invalidInput();
    this.#remainingValues += count;
    this.#ensureMinimumRemaining();
  }

  #setPayload(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0) this.#invalidInput();
    this.#ensureMinimumRemaining(length);
    this.#payloadBytes = length;
  }

  #setExtensionPayload(length: number): void {
    this.#setPayload(length + 1);
    this.#extensionTypePending = true;
  }

  #readLength(kind: LengthKind, bytes: number): void {
    this.#pending = { kind, bytes, read: 0, value: 0 };
  }

  #applyLength(kind: LengthKind, value: number): void {
    if (kind === 'array') this.#addChildren(value);
    else if (kind === 'map') this.#addChildren(value * 2);
    else {
      this.#setPayload(value + (kind === 'extension' ? 1 : 0));
      this.#extensionTypePending = kind === 'extension';
    }
  }

  #readToken(token: number): void {
    if (token <= 0x7f || token >= 0xe0 || (token >= 0xc0 && token <= 0xc3)) {
      if (token === 0xc1) this.#invalidInput();
      return;
    }
    if (token >= 0x80 && token <= 0x8f) return this.#addChildren((token & 0x0f) * 2);
    if (token >= 0x90 && token <= 0x9f) return this.#addChildren(token & 0x0f);
    if (token >= 0xa0 && token <= 0xbf) return this.#setPayload(token & 0x1f);

    switch (token) {
      case 0xc4: return this.#readLength('payload', 1);
      case 0xc5: return this.#readLength('payload', 2);
      case 0xc6: return this.#readLength('payload', 4);
      case 0xc7: return this.#readLength('extension', 1);
      case 0xc8: return this.#readLength('extension', 2);
      case 0xc9: return this.#readLength('extension', 4);
      case 0xca: return this.#setPayload(4);
      case 0xcb: return this.#setPayload(8);
      case 0xcc:
      case 0xd0: return this.#setPayload(1);
      case 0xcd:
      case 0xd1: return this.#setPayload(2);
      case 0xce:
      case 0xd2: return this.#setPayload(4);
      case 0xcf:
      case 0xd3: return this.#setPayload(8);
      case 0xd4: return this.#setExtensionPayload(1);
      case 0xd5: return this.#setExtensionPayload(2);
      case 0xd6: return this.#setExtensionPayload(4);
      case 0xd7: return this.#setExtensionPayload(8);
      case 0xd8: return this.#setExtensionPayload(16);
      case 0xd9: return this.#readLength('payload', 1);
      case 0xda: return this.#readLength('payload', 2);
      case 0xdb: return this.#readLength('payload', 4);
      case 0xdc: return this.#readLength('array', 2);
      case 0xdd: return this.#readLength('array', 4);
      case 0xde: return this.#readLength('map', 2);
      case 0xdf: return this.#readLength('map', 4);
      default: return this.#invalidInput();
    }
  }

  #completeIfReady(offset: number, boundaries: number[]): void {
    if (this.#pending || this.#payloadBytes > 0 || this.#remainingValues !== 0) return;
    this.#frames++;
    if (this.#frames > this.#maxFrames) {
      throw new Error(`[PipeX] Frame count exceeds ${this.#maxFrames}`);
    }
    boundaries.push(offset);
    this.#frameBytes = 0;
    this.#remainingValues = 1;
    this.#extensionTypePending = false;
  }

  #frameTooLarge(): never {
    throw new Error(`[PipeX] MessagePack frame exceeds ${this.#maxFrameBytes} bytes`);
  }

  #invalidInput(): never {
    throw new Error('[PipeX] Invalid MessagePack input');
  }
}

export function assertMessagePackFrameLimits(
  input: Buffer | Uint8Array,
  maxFrameBytes: number,
  maxFrames = Number.MAX_SAFE_INTEGER,
): number {
  const scanner = new MessagePackFrameScanner(maxFrameBytes, maxFrames);
  const boundaries = scanner.scan(Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  scanner.finish();
  return boundaries.length;
}

export function buildFrameLimitTransform(maxFrameBytes: number, maxFrames: number): Transform {
  const scanner = new MessagePackFrameScanner(maxFrameBytes, maxFrames);
  let frameChunks: Buffer[] = [];
  let frameBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const boundaries = scanner.scan(input);
        let start = 0;
        for (const boundary of boundaries) {
          const part = input.subarray(start, boundary);
          if (part.length > 0) {
            frameChunks.push(part);
            frameBytes += part.length;
          }
          this.push(frameChunks.length === 1 ? frameChunks[0] : Buffer.concat(frameChunks, frameBytes));
          frameChunks = [];
          frameBytes = 0;
          start = boundary;
        }
        if (start < input.length) {
          const part = input.subarray(start);
          frameChunks.push(part);
          frameBytes += part.length;
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        scanner.finish();
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}
