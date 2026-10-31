/** Authenticate fragmented stream data with HMAC-SHA-256 and verify on reversal. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { DataEngine, HashingPlugin } from '../dist/index.mjs';

const secret = randomBytes(32).toString('hex');
const engine = new DataEngine().use(new HashingPlugin({ algorithm: 'sha256', secret }));
const consume = async (chunks, reverse = false) => {
  const output = [];
  await engine.stream.pipe(
    Readable.from(chunks),
    new Writable({ write(chunk, _enc, done) { output.push(Buffer.from(chunk)); done(); } }),
    reverse,
  );
  return Buffer.concat(output);
};
const original = Buffer.from('SHA-256 authenticated stream '.repeat(100));
const tagged = await consume([original.subarray(0, 50), original.subarray(50)]);
const result = await consume([tagged.subarray(0, 7), tagged.subarray(7)], true);
assert.deepEqual(result, original);
console.log('SHA-256 HMAC stream round-trip OK');
// HMAC is keyed integrity protection, NOT encryption or an unkeyed digest.
