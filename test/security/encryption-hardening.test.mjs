import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { randomBytes, createCipheriv } from 'node:crypto';
import { DataEngine, EncryptionPlugin, KmsEncryptionPlugin, KmsAuthenticationError, InvalidKeyError, AuthenticationError } from '../../dist/index.mjs';

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
  const header = Buffer.alloc(29, 0);
  header[0] = 1;
  await assert.rejects(strict.binary.undo(header, 'buffer'), /legacy format disabled/);
});


test('authentication failures and logger output do not disclose key material', async () => {
  const entries = [];
  const logger = {
    info: (message, context) => entries.push([message, context]),
    warn: (message, context) => entries.push([message, context]),
    error: (message, context) => entries.push([message, context]),
    debug: (message, context) => entries.push([message, context]),
  };
  const engine = make();
  engine.setLogger(logger);
  const result = await engine.binary.run(Buffer.from('sensitive-message'));
  const corrupted = Buffer.from(result.data);
  corrupted[corrupted.length - 1] ^= 0x80;
  let observed;
  try { await engine.binary.undo(corrupted, 'buffer'); } catch (error) { observed = error; }
  assert.ok(observed instanceof AuthenticationError);
  const visible = JSON.stringify(entries) + String(observed);
  assert.doesNotMatch(visible, /sensitive-message/);
  assert.ok(!visible.includes(key.toString('hex')));
});


test('legacy encrypted records are rejected by default but explicitly migratable', async () => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  const plaintext = Buffer.from('legacy-example');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const legacy = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
  await assert.rejects(make().binary.undo(legacy, 'buffer'), /legacy format disabled/);
  const migrationReader = make('aes-256-gcm', { allowLegacyDecrypt: true });
  assert.deepEqual(await migrationReader.binary.undo(legacy, 'buffer'), plaintext);
});

test('KMS envelopes verify their tags and report sanitized failures', async () => {
  const dataKey = Buffer.alloc(32, 0x41);
  const provider = {
    async generateDataKey() { return { plaintext: Buffer.from(dataKey), ciphertext: Buffer.from('wrapped-key') }; },
    async decrypt() { return Buffer.from(dataKey); },
  };
  const engine = new DataEngine().use(new KmsEncryptionPlugin({ kms: provider, keyId: 'test-key' }));
  const result = await engine.binary.run(Buffer.from('kms-message'));
  const modified = Buffer.from(result.data);
  modified[modified.length - 1] ^= 0x01;
  await assert.rejects(engine.binary.undo(modified, 'buffer'), KmsAuthenticationError);
  assert.deepEqual(await engine.binary.undo(result.data, 'buffer'), Buffer.from('kms-message'));
});
