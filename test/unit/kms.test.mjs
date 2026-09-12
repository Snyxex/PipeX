import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import {
  DataEngine,
  DEFAULT_LIMITS,
  InvalidKmsProviderCapabilityError,
  KmsAuthenticationError,
  KmsEncryptionPlugin,
  KmsProviderAuthenticationError,
  KmsProviderError,
  KmsProviderUnavailableError,
  OperationAbortedError,
  OperationTimeoutError,
  UnsupportedKmsOperationError,
  UnsupportedStreamingError,
  getKmsProviderCapabilities,
  getPluginCapabilities,
  supportsKmsOperation,
} from '../../dist/index.mjs';

const dataKey = () => Buffer.alloc(32, 0x5a);
const envelope = Buffer.from('encrypted-data-key');

function legacyEnvelope(data) {
  const key = dataKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const keyLength = Buffer.alloc(4);
  keyLength.writeUInt32BE(envelope.length);
  key.fill(0);
  return Buffer.concat([keyLength, envelope, iv, cipher.getAuthTag(), ciphertext]);
}

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
  assert.equal(encrypted.subarray(0, 4).toString(), 'PXKM');
  assert.equal(encrypted.readUInt8(4), 1);
  assert.ok(generated.every(byte => byte === 0));
  assert.equal((await plugin.reverse(encrypted, {})).toString(), 'sensitive payload');
  assert.ok(decrypted.every(byte => byte === 0));
});

test('KMS authenticates envelope metadata and provides an explicit legacy migration switch', async () => {
  const plugin = new KmsEncryptionPlugin({ keyId: 'test-key', kms: provider() });
  const encrypted = await plugin.process(Buffer.from('sensitive payload'), {});
  for (const offset of [5, 16, encrypted.length - 1]) {
    const tampered = Buffer.from(encrypted);
    tampered[offset] ^= 1;
    await assert.rejects(plugin.reverse(tampered, {}), error => {
      assert.doesNotMatch(error.message, /sensitive payload/);
      return true;
    });
  }

  const legacy = legacyEnvelope(Buffer.from('legacy payload'));
  assert.equal((await plugin.reverse(legacy, {})).toString(), 'legacy payload');
  const strict = new KmsEncryptionPlugin({ keyId: 'test-key', kms: provider(), allowLegacyDecrypt: false });
  await assert.rejects(strict.reverse(legacy, {}), /legacy format disabled/);
});

test('KMS clears decrypted data keys when local authentication fails', async () => {
  const encrypting = new KmsEncryptionPlugin({ keyId: 'test-key', kms: provider() });
  const encrypted = await encrypting.process(Buffer.from('sensitive payload'), {});
  encrypted[encrypted.length - 1] ^= 1;
  const decryptedKey = dataKey();
  const decrypting = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async decrypt() { return decryptedKey; } }),
  });
  await assert.rejects(decrypting.reverse(encrypted, {}), error => {
    assert.ok(error instanceof KmsAuthenticationError);
    assert.equal(error.code, 'KMS_AUTHENTICATION_FAILED');
    return true;
  });
  assert.ok(decryptedKey.every(byte => byte === 0));
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

test('KMS provider failures preserve a sanitized, typed classification', async () => {
  const authentication = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({
      async generateDataKey() {
        throw new KmsProviderAuthenticationError('generateDataKey');
      },
    }),
  });
  await assert.rejects(authentication.process(Buffer.from('payload'), {}), error => {
    assert.ok(error instanceof KmsProviderAuthenticationError);
    assert.equal(error.code, 'KMS_PROVIDER_AUTHENTICATION_FAILED');
    return true;
  });

  const unavailable = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({
      async generateDataKey() {
        throw new KmsProviderUnavailableError('generateDataKey');
      },
    }),
  });
  await assert.rejects(unavailable.process(Buffer.from('payload'), {}), error => {
    assert.ok(error instanceof KmsProviderUnavailableError);
    assert.equal(error.code, 'KMS_PROVIDER_UNAVAILABLE');
    return true;
  });
});

test('KMS provider capabilities are queryable and fail closed', async () => {
  const compatibilityProvider = provider({
    capabilities: { encrypt: false },
    async encrypt() { throw new Error('generic unsupported stub'); },
  });
  assert.deepEqual(getKmsProviderCapabilities(compatibilityProvider), {
    encrypt: false,
    decrypt: true,
    generateDataKey: true,
  });
  assert.equal(Object.isFrozen(getKmsProviderCapabilities(compatibilityProvider)), true);
  assert.equal(supportsKmsOperation(compatibilityProvider, 'encrypt'), false);

  assert.throws(
    () => getKmsProviderCapabilities({ capabilities: { decrypt: true } }),
    InvalidKmsProviderCapabilityError,
  );
  assert.throws(
    () => new KmsEncryptionPlugin({ keyId: 'test-key', kms: { capabilities: { generateDataKey: false } } }),
    UnsupportedKmsOperationError,
  );

  const forwardOnly = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: {
      capabilities: { decrypt: false },
      async generateDataKey() { return { plaintext: dataKey(), ciphertext: Buffer.from(envelope) }; },
    },
  });
  assert.equal(forwardOnly.providerCapabilities.decrypt, false);
  assert.equal(getPluginCapabilities(forwardOnly).reverse, false);
  await forwardOnly.process(Buffer.from('supported'), {});
  await assert.rejects(forwardOnly.reverse(Buffer.from('secret-input'), {}), error => {
    assert.ok(error instanceof UnsupportedKmsOperationError);
    assert.doesNotMatch(error.message, /secret-input/);
    return true;
  });

  const drifting = provider({ capabilities: { decrypt: true } });
  const driftPlugin = new KmsEncryptionPlugin({ keyId: 'test-key', kms: drifting });
  delete drifting.decrypt;
  assert.throws(() => driftPlugin.providerCapabilities, InvalidKmsProviderCapabilityError);
  assert.throws(() => getPluginCapabilities(driftPlugin), InvalidKmsProviderCapabilityError);
});

test('KMS provider calls honor cancellation and clear keys returned after abort', async () => {
  let resolveKey;
  let providerSignal;
  const lateKey = dataKey();
  const waiting = new Promise(resolve => { resolveKey = resolve; });
  const plugin = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async generateDataKey(_keyId, options) { providerSignal = options.signal; return waiting; } }),
  });
  const controller = new AbortController();
  const operation = plugin.process(Buffer.from('payload'), { signal: controller.signal });
  controller.abort(new Error('cancel requested'));
  await assert.rejects(operation, OperationAbortedError);
  assert.equal(providerSignal.aborted, true);
  resolveKey({ plaintext: lateKey, ciphertext: Buffer.from(envelope) });
  await delay(0);
  assert.ok(lateKey.every(byte => byte === 0));
});

test('direct KMS calls enforce the central timeout and clear late plaintext keys', async () => {
  let resolveKey;
  let providerSignal;
  const lateKey = dataKey();
  const waiting = new Promise(resolve => { resolveKey = resolve; });
  const plugin = new KmsEncryptionPlugin({
    keyId: 'test-key',
    kms: provider({ async generateDataKey(_keyId, options) { providerSignal = options.signal; return waiting; } }),
  });
  const context = { limits: { ...DEFAULT_LIMITS, operationTimeoutMs: 5 } };
  await assert.rejects(plugin.process(Buffer.from('payload'), context), error => {
    assert.ok(error instanceof OperationTimeoutError);
    assert.equal(error.code, 'OPERATION_TIMEOUT');
    return true;
  });
  assert.equal(providerSignal.aborted, true);
  resolveKey({ plaintext: lateKey, ciphertext: Buffer.from(envelope) });
  await delay(0);
  assert.ok(lateKey.every(byte => byte === 0));
});

test('provider details never reach engine log messages or error contexts', async () => {
  const records = [];
  const engine = new DataEngine().setLogger({
    info(message, context) { records.push([message, context]); },
    warn(message, context) { records.push([message, context]); },
    error(message, context) { records.push([message, context]); },
    debug(message, context) { records.push([message, context]); },
  }).use(new KmsEncryptionPlugin({
    keyId: 'secret-key-id',
    kms: provider({ async generateDataKey() { throw new Error('token=provider-secret payload=private'); } }),
  }));

  await assert.rejects(engine.binary.run(Buffer.from('request-body-secret')), KmsProviderError);
  const logged = JSON.stringify(records);
  assert.doesNotMatch(logged, /provider-secret|request-body-secret|secret-key-id|payload=private/);
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
  assert.deepEqual(engine.pluginCapabilities[0], {
    plugin: 'kms-encryption@2.1.0',
    ...getPluginCapabilities(engine.plugins[0]),
  });
  assert.equal(engine.pluginCapabilities[0].reverse, true);
  assert.equal(engine.pluginCapabilities[0].streamMode, 'none');
  assert.throws(() => engine.stream.into(destination), UnsupportedStreamingError);
  assert.equal(called, false);
});
