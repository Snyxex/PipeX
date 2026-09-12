import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DataEngine, EncryptionPlugin, HashingPlugin, CompressionPlugin, WorkerPoolPlugin } from '../dist/index.mjs';

const collect = async (stream) => {
  const chunks = [];
  await pipeline(stream, new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } }));
  return Buffer.concat(chunks);
};

// Duplex pack/unpack must preserve object frames.
{
  const engine = new DataEngine();
  const packed = await collect(Readable.from([{ id: 1 }, { id: 2 }], { objectMode: true }).pipe(engine.stream.pack()));
  const values = [];
  await pipeline(Readable.from([packed]), engine.stream.unpack(), new Writable({
    objectMode: true,
    write(value, _encoding, callback) { values.push(value); callback(); },
  }));
  assert.deepEqual(values, [{ id: 1 }, { id: 2 }]);
}

// Authenticated stream transforms must not emit tampered plaintext.
{
  const key = randomBytes(32);
  const encrypted = await new EncryptionPlugin({ algorithm: 'aes-256-gcm', key }).process(Buffer.from('secret'), {});
  encrypted[encrypted.length - 1] ^= 1;
  let leaked = 0;
  await assert.rejects(pipeline(Readable.from([encrypted]), new EncryptionPlugin({ algorithm: 'aes-256-gcm', key }).createStream('decompress'), new Writable({ write(chunk, _encoding, callback) { leaked += chunk.length; callback(); } })));
  assert.equal(leaked, 0);
}

// File processing rejects same-file output before truncation.
{
  const root = await mkdtemp(join(tmpdir(), 'pipex-hardening-'));
  try {
    const input = join(root, 'input.txt');
    await writeFile(input, 'must survive');
    await assert.rejects(new DataEngine().file.process(input, input, root), /different files/);
    assert.equal((await readFile(input, 'utf8')), 'must survive');
  } finally { await rm(root, { recursive: true, force: true }); }
}

// HMAC stream verification must round-trip fragmented input without quadratic
// buffer concatenation or releasing bytes before authentication succeeds.
{
  const source = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  const plugin = new HashingPlugin({ algorithm: 'sha256', secret: '0123456789abcdef' });
  const tagged = await plugin.process(source, {});
  const fragments = Array.from({ length: 2048 }, (_, i) => tagged.subarray(i * Math.ceil(tagged.length / 2048), (i + 1) * Math.ceil(tagged.length / 2048)));
  const restored = await collect(Readable.from(fragments).pipe(plugin.createStream('decompress')));
  assert.deepEqual(restored, source);
}

// Built worker artifact must be loadable from the packed build.
{
  const plugin = new WorkerPoolPlugin({ maxThreads: 1 });
  assert.deepEqual([...await plugin.process(Buffer.from([1, 2]), {})], [0x43, 0x40]);
  await plugin.close();
}

console.log('hardening tests passed');
