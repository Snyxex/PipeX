import { DataEngine } from '../src/core/dataEngine.js';
import type { ProcessorPlugin } from '../src/core/types.js';

const uppercasePlugin: ProcessorPlugin = {
  name: 'uppercase',
  version: '1.0.0',
  process: (buf) => Buffer.from(buf.toString().toUpperCase()),
  reverse: (buf) => Buffer.from(buf.toString().toLowerCase()),
};

async function testCoreApi() {
  const engine = new DataEngine().use(uppercasePlugin);
  const events: string[] = [];

  engine.on('start', (id) => events.push(`start:${id}`));
  engine.on('plugin:after', (name) => events.push(`plugin:${name}`));
  engine.on('end', (id) => events.push(`end:${id}`));
  engine.on('error', (err) => {
    throw err;
  });

  const packed = engine.binary.pack({ id: 1, tags: ['a', 'b'] });
  const unpacked = engine.binary.unpack<{ id: number; tags: string[] }>(packed);
  if (unpacked.tags.length !== 2) {
    throw new Error('binary.pack/binary.unpack round-trip failed');
  }

  const result = await engine.binary.run('hello');
  const restored = await engine.binary.undo<string>(result);
  if (restored !== 'hello') {
    throw new Error(`binary.run/binary.undo round-trip failed: ${restored}`);
  }

  const withManifest = engine.binary.packWithManifest({ payload: 'data' });
  const { manifest, data } = engine.binary.unpackWithManifest<{ payload: string }>(withManifest);
  if (manifest.plugins[0] !== 'uppercase@1.0.0' || data.payload !== 'data') {
    throw new Error('binary manifest round-trip failed');
  }

  if (!events.some((event) => event.startsWith('start:')) || !events.includes('plugin:uppercase')) {
    throw new Error('expected lifecycle events were not emitted');
  }

  console.log('Core API test passed.');
}

testCoreApi().catch((err) => {
  console.error('Core API test failed:', err);
  process.exit(1);
});
