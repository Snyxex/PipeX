import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DataEngine, CompressionPlugin, BasePlugin } from '../../dist/index.mjs';

const timeout = 12_000;
const smallChunks = () => Readable.from(Array.from({ length: 12 }, () => Buffer.alloc(4096, 7)));
const sink = () => {
  const chunks = [];
  return { chunks, stream: new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } }) };
};

test('large file streams through compression and reverse without loading the entire file', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pipex-stream-large-'));
  try {
    const input = join(root, 'input.bin');
    const coded = join(root, 'encoded.px');
    const output = join(root, 'restored.bin');
    const bytes = Buffer.alloc(64 * 1024, 0x5a);
    const writer = createWriteStream(input);
    await pipeline(Readable.from(Array.from({ length: 256 }, () => bytes)), writer);
    const engine = new DataEngine({ maxInputBytes: 32 * 1024 * 1024, maxOutputBytes: 32 * 1024 * 1024 })
      .use(new CompressionPlugin({ type: 'gzip', level: 6 }));
    await engine.stream.pipe(createReadStream(input), createWriteStream(coded));
    await engine.stream.pipe(createReadStream(coded), createWriteStream(output), true);
    assert.deepEqual(await readFile(output), await readFile(input));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('abort tears down source and destination mid-stream and rejects promptly', { timeout }, async () => {
  const abort = new AbortController();
  let produced = 0;
  const source = new Readable({
    read() {
      if (this.destroyed) return;
      produced++;
      this.push(Buffer.alloc(64 * 1024, 1));
      if (produced === 4) queueMicrotask(() => abort.abort(new Error('stop requested')));
    },
  });
  const destination = new Writable({ highWaterMark: 1024, write(_chunk, _enc, callback) { setImmediate(callback); } });
  await assert.rejects(new DataEngine().stream.pipe(source, destination, false, { signal: abort.signal }));
  assert.equal(source.destroyed, true);
  assert.equal(destination.destroyed, true);
});

test('middle plugin failure rejects and destroys all connected streams', { timeout }, async () => {
  class Fail extends BasePlugin {
    name = 'fail';
    version = '1.0.0';
    process() { throw new Error('middle-stage-failure'); }
  }
  const src = smallChunks();
  const dst = sink().stream;
  const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip' })).use(new Fail());
  await assert.rejects(engine.stream.pipe(src, dst), /middle-stage-failure/);
  assert.equal(src.destroyed, true);
  assert.equal(dst.destroyed, true);
});

test('destination failure rejects and stops the source', { timeout }, async () => {
  const src = smallChunks();
  const dst = new Writable({ write(_c, _e, cb) { cb(new Error('destination-failure')); } });
  await assert.rejects(new DataEngine().stream.pipe(src, dst), /destination-failure/);
  assert.equal(src.destroyed, true);
  assert.equal(dst.destroyed, true);
});

test('engine supports repeated operations with new streams; already consumed streams do not replay data', { timeout }, async () => {
  const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip' }));
  for (let i = 0; i < 2; i++) {
    const source = smallChunks();
    const result = sink();
    await engine.stream.pipe(source, result.stream);
    assert.ok(Buffer.concat(result.chunks).length > 0);
  }
  const original = smallChunks();
  await engine.stream.pipe(original, sink().stream);
  await assert.rejects(engine.stream.pipe(original, sink().stream), /premature close|destroyed|closed|end|abort/i);
});

test('into adapter forwards failures and supports standard pipeline() cleanup', { timeout }, async () => {
  const engine = new DataEngine();
  const src = smallChunks();
  const destination = new Writable({ write(_c, _e, cb) { cb(new Error('adapter-destination-failure')); } });
  const adapter = engine.stream.into(destination);
  await assert.rejects(pipeline(src, adapter), /adapter-destination-failure/);
  assert.equal(src.destroyed, true);
  assert.equal(adapter.destroyed, true);
});
