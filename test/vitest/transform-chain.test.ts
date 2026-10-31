import { describe, expect, it } from 'vitest';
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from '../../src/index.js';

const key = Buffer.alloc(32, 0x54);
const secret = 'a sufficiently long secret for HMAC';

describe('built-in transform pipelines', () => {
  it.each(['gzip', 'brotli', 'none'] as const)('round-trips compression: %s', async type => {
    const engine = new DataEngine().use(new CompressionPlugin({ type }));
    const input = Buffer.from('A repeated string '.repeat(256));
    const result = await engine.binary.run(input);
    expect(await engine.binary.undo(result)).toEqual(input);
  });
  it.each(['aes-256-gcm', 'chacha20-poly1305'] as const)('authenticates %s', async algorithm => {
    const engine = new DataEngine().use(new EncryptionPlugin({ algorithm, key }));
    const input = Buffer.from('sensitive-payload');
    const result = await engine.binary.run(input);
    expect(await engine.binary.undo(result)).toEqual(input);
    const corrupted = Buffer.from(result.data);
    corrupted[corrupted.length - 1] ^= 1;
    await expect(engine.binary.undo(corrupted, 'buffer')).rejects.toThrow();
  });
  it.each(['sha256', 'sha512'] as const)('rejects tampered %s HMAC', async algorithm => {
    const engine = new DataEngine().use(new HashingPlugin({ algorithm, secret }));
    const result = await engine.binary.run(Buffer.from('message'));
    const modified = Buffer.from(result.data);
    modified[modified.length - 1] ^= 1;
    await expect(engine.binary.undo(modified, 'buffer')).rejects.toThrow();
  });
  it('round-trips combined compression, encryption and HMAC', async () => {
    const input = Buffer.from('Combined pipeline '.repeat(1024));
    const engine = new DataEngine()
      .use(new CompressionPlugin({ type: 'gzip' }))
      .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key }))
      .use(new HashingPlugin({ algorithm: 'sha256', secret }));
    const result = await engine.binary.run(input);
    expect(await engine.binary.undo(result)).toEqual(input);
  });
});
