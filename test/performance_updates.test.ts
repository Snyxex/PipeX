import { DataEngine } from '../src/core/dataEngine.js';
import { detectType, toBuffer, fromBuffer } from '../src/core/core.js';
import type { ProcessorPlugin } from '../src/core/types.js';
import { PassThrough, Readable } from 'node:stream';
import assert from 'node:assert';

async function testPerformanceUpdates() {
  console.log('--- Testing Performance Updates ---');

  // 1. Test detectType
  console.log('Testing detectType...');
  assert.strictEqual(detectType(null), 'null');
  assert.strictEqual(detectType([]), 'array');
  assert.strictEqual(detectType({}), 'object');
  assert.strictEqual(detectType(Buffer.from('hi')), 'buffer');
  assert.strictEqual(detectType('hi'), 'string');
  assert.strictEqual(detectType(123), 'number');
  console.log('✓ detectType ok');

  // 2. Test toBuffer/fromBuffer (MsgPack)
  console.log('Testing MsgPack serialization...');
  const obj = { a: 1, b: [2, 3] };
  const buf = toBuffer(obj);
  const restored = fromBuffer(buf, 'object');
  assert.deepStrictEqual(restored, obj);
  console.log('✓ MsgPack serialization ok');

  // 3. Test BinaryController.unpackWithManifest (optimized)
  console.log('Testing optimized unpackWithManifest...');
  const engine = new DataEngine();
  const data = { hello: 'world' };
  const packed = engine.binary.packWithManifest(data);
  const { manifest, data: unpackedData } = engine.binary.unpackWithManifest(packed);
  assert.ok(manifest.__pipex_v === 1);
  assert.deepStrictEqual(unpackedData, data);
  console.log('✓ unpackWithManifest ok');

  // 4. Test StreamController error propagation
  console.log('Testing stream error propagation...');
  const failingPlugin: ProcessorPlugin = {
    name: 'fail',
    version: '1.0.0',
    process: () => { throw new Error('Plugin failed'); }
  };
  const engineWithFail = new DataEngine().use(failingPlugin);
  engineWithFail.on('error', () => {}); // Handle engine error too
  const source = new PassThrough();
  const dest = new PassThrough();
  const entry = engineWithFail.stream.into(dest);

  const errorPromise = new Promise((resolve) => {
    entry.on('error', (err) => {
      assert.strictEqual(err.message, 'Plugin failed');
      resolve(true);
    });
  });

  source.pipe(entry);
  source.write(Buffer.from('data'));
  
  await errorPromise;
  console.log('✓ Stream error propagation ok');

  // 5. Test BinaryController.undo manifest validation
  console.log('Testing undo manifest validation...');
  const mockPlugin: ProcessorPlugin = {
    name: 'mock',
    version: '1.0.0',
    process: (b) => b,
    reverse: (b) => b
  };
  const engine1 = new DataEngine().use(mockPlugin);
  const packed1 = engine1.binary.packWithManifest({ test: 1 });

  // Different engine config
  const engine2 = new DataEngine(); // No plugins
  
  // This should trigger a console.warn, but not fail
  console.log('(Expect a warning below)');
  const restoredUndo = await engine2.binary.undo(packed1, 'object');
  assert.deepStrictEqual(restoredUndo, { test: 1 });
  console.log('✓ undo manifest validation/fallback ok');

  console.log('--- All Performance Update Tests Passed ---');
}

testPerformanceUpdates().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
