import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { EncryptionPlugin } from '../../dist/index.mjs';

const GLOBAL_HEADER_BYTES = 28;
const FRAME_HEADER_BYTES = 13;
const TAG_BYTES = 16;

function splitPacket(packet) {
  const frames = [];
  let offset = GLOBAL_HEADER_BYTES;
  while (offset < packet.length) {
    const start = offset;
    const ciphertextBytes = packet.readUInt32BE(offset + 9);
    offset += FRAME_HEADER_BYTES + ciphertextBytes + TAG_BYTES;
    assert.ok(offset <= packet.length, 'test packet must contain complete frames');
    frames.push(Buffer.from(packet.subarray(start, offset)));
  }
  return { header: Buffer.from(packet.subarray(0, GLOBAL_HEADER_BYTES)), frames };
}

function legacyEncrypt(data, key, algorithm = 'aes-256-gcm') {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([
    Buffer.from([algorithm === 'aes-256-gcm' ? 1 : 2]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

async function collect(stream) {
  const chunks = [];
  await pipeline(stream, new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setImmediate(callback);
    },
  }));
  return Buffer.concat(chunks);
}

for (const algorithm of ['aes-256-gcm', 'chacha20-poly1305']) {
  test(`framed ${algorithm} handles empty and multi-frame inputs`, async () => {
    const key = randomBytes(32);
    const plugin = new EncryptionPlugin({ algorithm, key, frameSizeBytes: 31 });
    for (const input of [Buffer.alloc(0), randomBytes(257)]) {
      const encrypted = await plugin.process(input, {});
      assert.equal(encrypted.subarray(0, 4).toString(), 'PXAE');
      assert.equal(encrypted.readUInt8(4), 1);
      assert.deepEqual(await plugin.reverse(encrypted, {}), input);
    }
  });
}

test('framed stream decryption accepts byte-fragmented input with a slow consumer', async () => {
  const key = randomBytes(32);
  const plugin = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key, frameSizeBytes: 64 });
  const input = randomBytes(4097);
  const encrypted = await collect(Readable.from([
    input.subarray(0, 1000),
    input.subarray(1000, 3000),
    input.subarray(3000),
  ]).pipe(plugin.createStream('compress')));
  const fragments = [...encrypted].map(byte => Buffer.from([byte]));
  const restored = await collect(Readable.from(fragments).pipe(plugin.createStream('decompress')));
  assert.deepEqual(restored, input);
});

test('framed decryption rejects authenticated-header, tag, order, duplication, and truncation attacks', async () => {
  const key = randomBytes(32);
  const plugin = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key, frameSizeBytes: 16 });
  const encrypted = await plugin.process(Buffer.from('classified-payload-do-not-log'), {});
  const { header, frames } = splitPacket(encrypted);
  assert.ok(frames.length >= 3);

  const changedHeader = Buffer.from(encrypted);
  changedHeader[12] ^= 1;

  const changedTag = Buffer.from(encrypted);
  const firstLength = changedTag.readUInt32BE(GLOBAL_HEADER_BYTES + 9);
  changedTag[GLOBAL_HEADER_BYTES + FRAME_HEADER_BYTES + firstLength] ^= 1;

  const reordered = Buffer.concat([header, frames[1], frames[0], ...frames.slice(2)]);
  const duplicated = Buffer.concat([header, frames[0], frames[0], ...frames.slice(1)]);
  const truncated = Buffer.concat([header, ...frames.slice(0, -1)]);
  const partial = encrypted.subarray(0, encrypted.length - 3);

  for (const malformed of [changedHeader, changedTag, reordered, duplicated, truncated, partial]) {
    await assert.rejects(plugin.reverse(malformed, {}), error => {
      assert.doesNotMatch(error.message, /classified-payload-do-not-log/);
      return true;
    });
  }
});

test('stream decryption releases no plaintext from a frame before its tag verifies', async () => {
  const key = randomBytes(32);
  const plugin = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key, frameSizeBytes: 8 });
  const encrypted = await plugin.process(Buffer.from('never expose this frame'), {});
  const firstLength = encrypted.readUInt32BE(GLOBAL_HEADER_BYTES + 9);
  encrypted[GLOBAL_HEADER_BYTES + FRAME_HEADER_BYTES + firstLength] ^= 1;
  let emitted = 0;
  await assert.rejects(pipeline(
    Readable.from([...encrypted].map(byte => Buffer.from([byte]))),
    plugin.createStream('decompress'),
    new Writable({ write(chunk, _encoding, callback) { emitted += chunk.length; callback(); } }),
  ));
  assert.equal(emitted, 0);
});

test('declared frame sizes and frame counts are rejected before frame allocation or cryptography', async () => {
  const key = randomBytes(32);
  const plugin = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key, frameSizeBytes: 8 });
  const encrypted = await plugin.process(Buffer.alloc(16), {});
  const oversized = Buffer.from(encrypted);
  oversized.writeUInt32BE(0xffff_ffff, GLOBAL_HEADER_BYTES + 9);
  await assert.rejects(plugin.reverse(oversized, {}), /frame length exceeds configured limit/);

  const bounded = {
    limits: {
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      maxFrameBytes: 128,
      maxFrames: 1,
    },
  };
  await assert.rejects(plugin.process(Buffer.alloc(16), bounded), /frame count exceeds 1/);
  await assert.rejects(plugin.reverse(encrypted, bounded), /frame count exceeds 1/);

  let encryptedBytesEmitted = 0;
  await assert.rejects(pipeline(
    Readable.from([Buffer.alloc(16)]),
    plugin.createStream('compress', bounded),
    new Writable({ write(chunk, _encoding, callback) { encryptedBytesEmitted += chunk.length; callback(); } }),
  ), /frame count exceeds 1/);
  assert.equal(encryptedBytesEmitted, 0);
});

test('legacy v3 packets remain readable only when migration compatibility is enabled', async () => {
  const key = randomBytes(32);
  const input = Buffer.from('legacy encrypted payload');
  const legacy = legacyEncrypt(input, key);
  const compatible = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key });
  assert.deepEqual(await compatible.reverse(legacy, {}), input);
  assert.deepEqual(await collect(Readable.from([...legacy].map(byte => Buffer.from([byte]))).pipe(compatible.createStream('decompress'))), input);

  const strict = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key, allowLegacyDecrypt: false });
  await assert.rejects(strict.reverse(legacy, {}), /legacy format disabled/);
  await assert.rejects(collect(Readable.from([legacy]).pipe(strict.createStream('decompress'))), /legacy format disabled/);
});

test('truncated framed magic is never reinterpreted as a legacy packet', async () => {
  const plugin = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: randomBytes(32) });
  await assert.rejects(plugin.reverse(Buffer.from('PXA'), {}), /incomplete framed header/);
});
