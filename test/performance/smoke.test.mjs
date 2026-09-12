import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CompressionPlugin } from '../../dist/index.mjs';

test('binary compression yields to the event loop', { timeout: 10_000 }, async () => {
  const plugin = new CompressionPlugin({ type: 'brotli', level: 3 });
  const order = [];
  const work = plugin.process(randomBytes(2 * 1024 * 1024), {}).then(result => {
    order.push('compressed');
    return result;
  });
  await new Promise(resolve => setImmediate(() => { order.push('event-loop'); resolve(); }));
  const result = await work;
  assert.equal(order[0], 'event-loop');
  assert.ok(result.length > 0);
});
