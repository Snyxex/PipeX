import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CompressionPlugin, DataEngine } from '../../dist/index.mjs';

const collect = async stream => {
  const chunks = [];
  await pipeline(stream, new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } }));
  return Buffer.concat(chunks);
};

test('file transform round-trip is atomic and preserves the source', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pipex-files-'));
  try {
    const input = join(root, 'input.txt');
    const encoded = join(root, 'encoded.pipex');
    const restored = join(root, 'restored.txt');
    const value = Buffer.from('file round trip '.repeat(10_000));
    await writeFile(input, value);
    const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip', level: 1 }));
    await engine.file.process(input, encoded, root);
    await engine.file.reverse(encoded, restored, root);
    assert.deepEqual(await readFile(restored), value);
    assert.deepEqual(await readFile(input), value);
    await assert.rejects(engine.file.process(input, input, root), /different files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('object stream pack and unpack round-trip', async () => {
  const engine = new DataEngine();
  const values = [{ id: 1 }, { id: 2 }];
  const packed = await collect(Readable.from(values).pipe(engine.stream.pack()));
  const restored = [];
  await pipeline(
    Readable.from([packed]),
    engine.stream.unpack(),
    new Writable({ objectMode: true, write(value, _encoding, callback) { restored.push(value); callback(); } }),
  );
  assert.deepEqual(restored, values);
});

test('native Duplex bridge applies backpressure to a slow consumer', { timeout: 10_000 }, async () => {
  const engine = new DataEngine({ maxFrames: 5_000 });
  const packer = engine.stream.pack();
  let maxBuffered = 0;
  await pipeline(
    Readable.from(Array.from({ length: 2_000 }, (_, id) => ({ id, value: 'x'.repeat(512) }))),
    packer,
    new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        maxBuffered = Math.max(maxBuffered, packer.readableLength);
        setImmediate(callback);
      },
    }),
  );
  assert.ok(maxBuffered < 512 * 1024, `bridge buffered ${maxBuffered} bytes`);
});

test('stream pipeline propagates plugin failures', async () => {
  const engine = new DataEngine().use({
    name: 'failure',
    version: '1.0.0',
    process() { throw new Error('plugin failed'); },
  });
  await assert.rejects(
    engine.stream.pipe(
      Readable.from([Buffer.from('data')]),
      new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    ),
    /plugin failed/,
  );
});
