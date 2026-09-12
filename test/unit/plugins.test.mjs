import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  BenchmarkPlugin,
  CompressionPlugin,
  EncryptionPlugin,
  HashingPlugin,
  ValidationPlugin,
} from '../../dist/index.mjs';

const context = () => ({ requestId: 'test', timestamp: Date.now(), metadata: {} });

for (const type of ['gzip', 'brotli', 'none']) {
  test(`compression round-trip: ${type}`, { timeout: 10_000 }, async () => {
    const plugin = new CompressionPlugin({ type, ...(type === 'none' ? {} : { level: 1 }) });
    const input = Buffer.from('compressible payload '.repeat(2_000));
    assert.deepEqual(await plugin.reverse(await plugin.process(input, context()), context()), input);
  });
}

for (const algorithm of ['aes-256-gcm', 'chacha20-poly1305']) {
  test(`authenticated encryption round-trip and tamper rejection: ${algorithm}`, async () => {
    const plugin = new EncryptionPlugin({ algorithm, key: randomBytes(32) });
    const input = Buffer.from('confidential');
    const encrypted = await plugin.process(input, context());
    assert.deepEqual(await plugin.reverse(encrypted, context()), input);
    encrypted[encrypted.length - 1] ^= 1;
    await assert.rejects(plugin.reverse(encrypted, context()));
  });
}

test('HMAC verifies valid data and rejects tampering', async () => {
  const plugin = new HashingPlugin({ algorithm: 'sha256', secret: '0123456789abcdef' });
  const input = Buffer.from('integrity');
  const tagged = await plugin.process(input, context());
  assert.deepEqual(await plugin.reverse(tagged, context()), input);
  tagged[0] ^= 1;
  await assert.rejects(plugin.reverse(tagged, context()), /HMAC verification failed/);
});

test('validation plugin checks decoded MessagePack values', async () => {
  const schema = z.object({ id: z.number() });
  const plugin = new ValidationPlugin({ schema, validateOnReverse: true });
  const { DataEngine } = await import('../../dist/index.mjs');
  const engine = new DataEngine();
  await plugin.process(engine.binary.pack({ id: 1 }), context());
  await assert.rejects(plugin.process(engine.binary.pack({ id: 'bad' }), context()), /Validation failed/);
});

test('benchmark plugin records metrics without changing bytes', async () => {
  const plugin = new BenchmarkPlugin();
  const ctx = context();
  const input = Buffer.from('metrics');
  assert.equal(await plugin.process(input, ctx), input);
  assert.equal(await plugin.reverse(input, ctx), input);
  assert.equal(ctx.metadata['benchmark:in_bytes'], input.length);
  assert.equal(ctx.metadata['benchmark:out_bytes'], input.length);
});
