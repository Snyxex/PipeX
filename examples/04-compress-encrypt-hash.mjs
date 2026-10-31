/** Pipeline order is compression -> authenticated encryption -> HMAC. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from '../dist/index.mjs';

const key = randomBytes(32);
const hmacSecret = randomBytes(32).toString('hex');
try {
  const engine = new DataEngine()
    .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
    .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key, allowLegacyDecrypt: false }))
    .use(new HashingPlugin({ algorithm: 'sha256', secret: hmacSecret }));
  const source = Buffer.from('Compress, encrypt, and authenticate. '.repeat(200));
  const encoded = await engine.binary.run(source);
  assert.deepEqual(await engine.binary.undo(encoded), source);
  console.log('Combined pipeline round-trip OK');
} finally {
  key.fill(0);
}
