/** A custom reversible Buffer plugin; process and reverse invert the same bytes. */
import assert from 'node:assert/strict';
import { DataEngine } from '../dist/index.mjs';

class ReverseBytesPlugin {
  name = 'reverse-bytes';
  version = '1.0.0';
  reversible = true;
  process(data, _context) {
    return Buffer.from(data).reverse();
  }
  reverse(data, _context) {
    return Buffer.from(data).reverse();
  }
}
const engine = new DataEngine().use(new ReverseBytesPlugin());
const source = Buffer.from('custom plugin example');
const transformed = await engine.binary.run(source);
assert.deepEqual(await engine.binary.undo(transformed), source);
console.log('Custom reversible transform OK');
