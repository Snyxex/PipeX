import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { z } from 'zod';
import {
  BasePlugin,
  DataEngine,
  UnsupportedReverseError,
} from '../../dist/index.mjs';

test('binary values round-trip with their original type', { timeout: 5_000 }, async () => {
  const engine = new DataEngine();
  const values = [null, true, 42, 'hello', Buffer.from('bytes'), [1, 2], { id: 1 }];
  for (const value of values) {
    const result = await engine.binary.run(value);
    const restored = await engine.binary.undo(result);
    assert.deepEqual(restored, value);
  }
});

test('MessagePack and manifest APIs are serialization-only', () => {
  const engine = new DataEngine();
  const value = { id: 7, tags: ['a', 'b'] };
  assert.deepEqual(engine.binary.unpack(engine.binary.pack(value)), value);
  const packed = engine.binary.packWithManifest(value);
  const decoded = engine.binary.unpackWithManifest(packed);
  assert.deepEqual(decoded.data, value);
  assert.deepEqual(decoded.manifest.plugins, []);

  const transformed = new DataEngine().use({ name: 'identity', version: '1.0.0', process: data => data });
  assert.throws(() => transformed.binary.packWithManifest(value), /serialization-only/);
});

test('configuration wires limits, schema registry, and custom plugins', async () => {
  class PrefixPlugin extends BasePlugin {
    name = 'test-prefix';
    version = '1.0.0';
    process(data) { return Buffer.concat([Buffer.from('x'), data]); }
    reverse(data) { return data.subarray(1); }
  }
  DataEngine.registerPlugin('test-prefix', PrefixPlugin);
  const registry = { async getSchema() { return z.object({ id: z.number() }); } };
  const engine = await DataEngine.fromConfig({
    limits: { maxConcurrentOperations: 2 },
    schemaRegistry: registry,
    plugins: [{ name: 'test-prefix' }],
  });
  await engine.loadSchema('record');
  assert.equal(engine.limits.maxConcurrentOperations, 2);
  assert.deepEqual(await engine.binary.undo(await engine.binary.run({ id: 1 })), { id: 1 });
  await assert.rejects(engine.binary.run({ id: 'wrong' }), /Validation failed/);
});

test('forward-only plugins fail closed before reverse execution', async () => {
  class ForwardOnly extends BasePlugin {
    name = 'forward-only';
    version = '1.0.0';
    process(data) { return data; }
  }
  const engine = new DataEngine().use(new ForwardOnly());
  const result = await engine.binary.run(Buffer.from('payload'));
  await assert.rejects(engine.binary.undo(result), error => {
    assert.ok(error instanceof UnsupportedReverseError);
    assert.equal(error.code, 'UNSUPPORTED_REVERSE');
    return true;
  });
});

test('invalid integration objects fail during setup', () => {
  const engine = new DataEngine();
  assert.throws(() => engine.setLogger({}), /Logger must implement/);
  assert.throws(() => engine.setTracer({}), /Tracer must implement/);
  assert.throws(() => engine.setAuditLogger({}), /Audit logger must implement/);
  assert.throws(() => engine.setDlq({}), /writable stream/);
  assert.throws(() => engine.stream.into(new Writable({ write(_chunk, _encoding, callback) { callback(); } }), { timeoutMs: -1 }), /Invalid operation timeout/);
});
