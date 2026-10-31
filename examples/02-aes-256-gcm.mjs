/** Authenticated AES-256-GCM; generate an ephemeral key or supply PIPEX_KEY_HEX. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DataEngine, EncryptionPlugin } from '../dist/index.mjs';

const supplied = process.env.PIPEX_KEY_HEX;
if (supplied !== undefined && !/^[0-9a-fA-F]{64}$/.test(supplied)) {
  throw new Error('PIPEX_KEY_HEX must contain exactly 64 hexadecimal characters');
}
const key = supplied ? Buffer.from(supplied, 'hex') : randomBytes(32);
try {
  const engine = new DataEngine().use(new EncryptionPlugin({
    algorithm: 'aes-256-gcm', key, allowLegacyDecrypt: false,
  }));
  const plaintext = Buffer.from('Ephemeral authenticated encryption sample');
  const encrypted = await engine.binary.run(plaintext);
  assert.deepEqual(await engine.binary.undo(encrypted), plaintext);
  const tampered = Buffer.from(encrypted.data);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(engine.binary.undo(tampered, 'buffer'));
  console.log('AES-256-GCM authentication and round-trip OK');
} finally {
  key.fill(0);
}
// In production use a KMS/secret manager, never print or commit keys.
