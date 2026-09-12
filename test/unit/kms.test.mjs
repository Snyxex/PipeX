import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import {
  DataEngine,
  KmsEncryptionPlugin,
  KmsProviderError,
  OperationAbortedError,
  OperationTimeoutError,
  UnsupportedStreamingError,
} from '../../dist/index.mjs';

const dataKey = () => Buffer.alloc(32, 0x5a);
const envelope = Buffer.from('encrypted-data-key');

function provider(overrides = {}) {
  return {
    async encrypt(data) { return Buffer.from(data); },
    async generateDataKey(_keyId, options) {
      options?.signal?.throwIfAborted();
      return { plaintext: dataKey(), ciphertext: Buffer.from(envelope) };
    },
    async decrypt(_data, _keyId, options) {
      options?.signal?.throwIfAborted();
      return dataKey();
    },
    ...overrides,
  };
}

test('KMS envelope encryption round-trips and clears plaintext data keys', async () => {
  const generated = dataKey();
  const decrypted = dataKey();
  const plugin = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({
      async generateDataKey() { return { plaintext: generated, ciphertext: Buffer.from(envelope) }; },
      async decrypt() { return decrypted; },
    }),
  });

  const encrypted = await plugin.process(Buffer.from('sensitive payload'), {});
  assert.ok(generated.every(byte => byte === 0));
  assert.equal((await plugin.reverse(encrypted, {})).toString(), 'sensitive payload');
  assert.ok(decrypted.every(byte => byte === 0));
});

test('KMS failures are typed, sanitized, and clear invalid plaintext keys', async () => {
  const invalidKey = Buffer.alloc(16, 0xa5);
  const plugin = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({
      async generateDataKey() { return { plaintext: invalidKey, ciphertext: Buffer.from(envelope) }; },
    }),
  });
  await assert.rejects(plugin.process(Buffer.from('payload'), {}), /invalid data key/);
  assert.ok(invalidKey.every(byte => byte === 0));

  const failing = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async generateDataKey() { throw new Error('provider secret details'); } }),
  });
  await assert.rejects(failing.process(Buffer.from('payload'), {}), error => {
    assert.ok(error instanceof KmsProviderError);
    assert.equal(error.code, 'KMS_PROVIDER_FAILURE');
    assert.doesNotMatch(error.message, /secret details/);
    return true;
  });
});

test('KMS provider calls honor cancellation and clear keys returned after abort', async () => {
  let resolveKey;
  const lateKey = dataKey();
  const waiting = new Promise(resolve => { resolveKey = resolve; });
  const plugin = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async generateDataKey() { return waiting; } }),
  });
  const controller = new AbortController();
  const operation = plugin.process(Buffer.from('payload'), { signal: controller.signal });
  controller.abort(new Error('cancel requested'));
  await assert.rejects(operation, OperationAbortedError);
  resolveKey({ plaintext: lateKey, ciphertext: Buffer.from(envelope) });
  await delay(0);
  assert.ok(lateKey.every(byte => byte === 0));
});

test('engine timeouts interrupt KMS calls and release concurrency capacity', async () => {
  const engine = new DataEngine({ maxConcurrentOperations: 1 }).use(new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async generateDataKey() { return new Promise(() => {}); } }),
  }));
  await assert.rejects(engine.binary.run(Buffer.from('payload'), { timeoutMs: 10 }), OperationTimeoutError);

  const healthy = new DataEngine({ maxConcurrentOperations: 1 }).use(new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider(),
  }));
  await healthy.binary.run(Buffer.from('capacity is available'));
});

test('KMS plugin rejects stream mode before contacting its provider', () => {
  let called = false;
  const engine = new DataEngine().use(new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async generateDataKey() { called = true; throw new Error('must not run'); } }),
  }));
  const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  assert.throws(() => engine.stream.into(destination), UnsupportedStreamingError);
  assert.equal(called, false);
});
