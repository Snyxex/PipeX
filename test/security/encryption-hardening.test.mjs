import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { DataEngine, EncryptionPlugin, InvalidKeyError, AuthenticationError } from '../../dist/index.mjs';

const key = Buffer.alloc(32, 0x51);
const make = (algorithm = 'aes-256-gcm', options = {}) =>
  new DataEngine().use(new EncryptionPlugin({ algorithm, key, ...options }));

for (const algorithm of ['aes-256-gcm', 'chacha20-poly1305']) {
  test(algorithm + ': valid authenticated round-trip', async () => {
    const e = make(algorithm);
    const encrypted = await e.binary.run(Buffer.from('authenticated payload'));
    assert.deepEqual(await e.binary.undo(encrypted), Buffer.from('authenticated payload'));
  });

  test(algorithm + ': ciphertext and tag tampering fail closed', async () => {
    const e = make(algorithm);
    const result = await e.binary.run(Buffer.from('authenticated payload'));
    const modified = Buffer.from(result.data);
    modified[modified.length - 1] ^= 0xff;
    await assert.rejects(e.binary.undo(modified, 'buffer'), AuthenticationError);
    const truncated = result.data.subarray(0, result.data.length - 1);
    await assert.rejects(e.binary.undo(truncated, 'buffer'));
  });

  test(algorithm + ': wrong key is rejected', async () => {
    const producer = make(algorithm);
    const other = new DataEngine().use(new EncryptionPlugin({ algorithm, key: Buffer.alloc(32, 0xa2) }));
    const result = await producer.binary.run(Buffer.from('private'));
    await assert.rejects(other.binary.undo(result.data, 'buffer'), AuthenticationError);
  });
}

test('invalid key lengths and types are rejected', () => {
  for (const wrong of [Buffer.alloc(0), Buffer.alloc(16), Buffer.alloc(31), Buffer.alloc(33), 'not-a-key']) {
    assert.throws(() => new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: wrong }), InvalidKeyError);
  }
});

test('truncated authentication tag cannot validate', async () => {
  const engine = make();
  const output = await engine.binary.run(Buffer.from('data'));
  const truncatedTag = Buffer.from(output.data);
  // Truncate the authenticated final frame by one byte.
  await assert.rejects(engine.binary.undo(truncatedTag.subarray(0, -1), 'buffer'));
});

test('aborted encrypted stream rejects and closes all streams', { timeout: 10_000 }, async () => {
  const signal = new AbortController();
  let reads = 0;
  const source = new Readable({
    read() {
      reads++;
      this.push(Buffer.alloc(16 * 1024, 1));
      if (reads === 4) queueMicrotask(() => signal.abort());
    },
  });
  const destination = new Writable({ write(_data, _encoding, callback) { setImmediate(callback); } });
  await assert.rejects(make().stream.pipe(source, destination, false, { signal: signal.signal }));
  assert.equal(source.destroyed, true);
  assert.equal(destination.destroyed, true);
});

test('legacy decryption requires explicit opt-in', async () => {
  const strict = make();
  assert.equal(strict.plugins[0].options?.allowLegacyDecrypt, undefined);
  const header = Buffer.alloc(29, 0);
  header[0] = 1;
  await assert.rejects(strict.binary.undo(header, 'buffer'), /legacy format disabled/);
});
