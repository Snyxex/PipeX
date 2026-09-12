import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
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

test('compression decompression respects a slow consumer across fragmented input', { timeout: 10_000 }, async () => {
  const plugin = new CompressionPlugin({ type: 'gzip', level: 1 });
  const source = randomBytes(4 * 1024 * 1024);
  const compressed = await plugin.process(source, {});
  const fragments = [];
  for (let offset = 0; offset < compressed.length; offset += 4 * 1024) {
    fragments.push(compressed.subarray(offset, offset + 4 * 1024));
  }

  const decompressor = plugin.createStream('decompress');
  let restoredBytes = 0;
  let maxBuffered = 0;
  await pipeline(
    Readable.from(fragments),
    decompressor,
    new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        restoredBytes += chunk.length;
        maxBuffered = Math.max(maxBuffered, decompressor.readableLength);
        setImmediate(callback);
      },
    }),
  );
  assert.equal(restoredBytes, source.length);
  assert.ok(maxBuffered < 512 * 1024, `decompressor buffered ${maxBuffered} bytes`);
});

test('compression stream errors retain their cause and are reported once', async () => {
  const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip' }));
  const errors = [];
  engine.on('error', error => errors.push(error));
  const source = Readable.from([Buffer.from([1]), Buffer.from('invalid gzip payload')]);
  const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

  let rejected;
  await assert.rejects(
    engine.stream.pipe(source, destination, true),
    error => {
      rejected = error;
      assert.equal(error.code, 'Z_DATA_ERROR');
      return true;
    },
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0], rejected);
  assert.equal(source.destroyed, true);
  assert.equal(destination.destroyed, true);
});

test('stream cancellation destroys the complete pipeline exactly once', { timeout: 10_000 }, async () => {
  const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip', level: 1 }));
  const errors = [];
  engine.on('error', error => errors.push(error));
  let produced = 0;
  const source = new Readable({
    read() {
      while (produced++ < 10_000 && this.push(Buffer.alloc(16 * 1024, 0x5a))) {}
    },
  });
  const destination = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) { setImmediate(callback); },
  });
  const controller = new AbortController();
  const reason = new Error('cancel stream');
  const operation = engine.stream.pipe(source, destination, false, { signal: controller.signal, timeoutMs: 0 });
  setImmediate(() => controller.abort(reason));

  await assert.rejects(operation, error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.cause, reason);
    return true;
  });
  assert.equal(errors.length, 1);
  assert.equal(source.destroyed, true);
  assert.equal(destination.destroyed, true);
});

test('into waits for destination finalization and forwards late failures once', async () => {
  const failure = new Error('destination final failed');
  const destination = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
    final(callback) { setImmediate(() => callback(failure)); },
  });
  const engine = new DataEngine();
  const errors = [];
  engine.on('error', error => errors.push(error));

  await assert.rejects(
    pipeline(Readable.from([Buffer.from('one'), Buffer.from('two')]), engine.stream.into(destination)),
    error => error === failure,
  );
  assert.deepEqual(errors, [failure]);
});

test('into and reverseInto preserve half-close and destination finalization', async () => {
  const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip', level: 1 }));
  const encoded = [];
  let forwardFinalized = false;
  await pipeline(
    Readable.from([Buffer.from('first '), Buffer.from('second')]),
    engine.stream.into(new Writable({
      write(chunk, _encoding, callback) { encoded.push(chunk); callback(); },
      final(callback) { setImmediate(() => { forwardFinalized = true; callback(); }); },
    })),
  );
  assert.equal(forwardFinalized, true);

  const restored = [];
  let reverseFinalized = false;
  await pipeline(
    Readable.from(encoded),
    engine.stream.reverseInto(new Writable({
      write(chunk, _encoding, callback) { restored.push(chunk); callback(); },
      final(callback) { setImmediate(() => { reverseFinalized = true; callback(); }); },
    })),
  );
  assert.equal(reverseFinalized, true);
  assert.equal(Buffer.concat(restored).toString(), 'first second');
});

test('native stream tracing ends each plugin span exactly once', async () => {
  let ended = 0;
  const engine = new DataEngine().setTracer({
    startSpan() {
      return {
        setAttribute() { return this; },
        addEvent() { return this; },
        end() { ended++; },
      };
    },
  }).use(new CompressionPlugin({ type: 'gzip', level: 1 }));
  await engine.stream.pipe(
    Readable.from([Buffer.from('one'), Buffer.from('two')]),
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  );
  assert.equal(ended, 1);
});

test('aborting a bridged object stream destroys the duplex and reports once', { timeout: 10_000 }, async () => {
  const controller = new AbortController();
  const engineErrors = [];
  const streamErrors = [];
  const engine = new DataEngine({ maxFrames: 10_000 });
  engine.on('error', error => engineErrors.push(error));
  const packer = engine.stream.pack({ signal: controller.signal, timeoutMs: 0 });
  const closed = new Promise(resolve => {
    packer.on('error', error => streamErrors.push(error));
    packer.once('close', resolve);
  });
  packer.write({ id: 1, payload: 'x'.repeat(1024) });
  const reason = new Error('cancel pack');
  controller.abort(reason);
  await closed;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(packer.destroyed, true);
  assert.equal(streamErrors.length, 1);
  assert.equal(streamErrors[0].name, 'AbortError');
  assert.equal(streamErrors[0].cause, reason);
  assert.equal(engineErrors.length, 1);
});

test('cancellation removes listeners while a failed chunk waits for DLQ backpressure', { timeout: 10_000 }, async () => {
  const dlq = new PassThrough({ highWaterMark: 1 });
  const controller = new AbortController();
  const engine = new DataEngine().setDlq(dlq).use({
    name: 'always-fails',
    version: '1.0.0',
    process() { throw new Error('plugin failure'); },
  });
  const operation = engine.stream.pipe(
    Readable.from([Buffer.alloc(1024)]),
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    false,
    { signal: controller.signal, timeoutMs: 0 },
  );
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('cancel blocked DLQ write'));
  await assert.rejects(operation, /abort|cancel/i);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(dlq.listenerCount('drain'), 0);
  assert.equal(dlq.listenerCount('error'), 0);
  dlq.destroy();
});

test('caller-owned failure sink has no replay and preserves backpressure and sink errors', { timeout: 10_000 }, async () => {
  const pluginFailure = new Error('plugin failure');
  const engine = new DataEngine().use({
    name: 'always-fails',
    version: '1.0.0',
    process() { throw pluginFailure; },
  });
  const destination = () => new Writable({ write(_chunk, _encoding, callback) { callback(); } });

  await assert.rejects(
    engine.stream.pipe(Readable.from([Buffer.from('not-retained')]), destination()),
    error => error === pluginFailure,
  );

  const received = [];
  let releaseWrite;
  let markWriteStarted;
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
  const sink = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      received.push(Buffer.from(chunk));
      releaseWrite = callback;
      markWriteStarted();
    },
  });
  engine.setDlq(sink);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received, [], 'a newly attached sink must not receive earlier failures');

  let operationSettled = false;
  const operation = engine.stream.pipe(
    Readable.from([Buffer.from('current-failure')]),
    destination(),
    false,
    { timeoutMs: 0 },
  );
  void operation.then(
    () => { operationSettled = true; },
    () => { operationSettled = true; },
  );
  await writeStarted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(operationSettled, false, 'operation must wait for failure-sink backpressure');
  releaseWrite();
  await assert.rejects(operation, error => error === pluginFailure);
  assert.deepEqual(received.map(chunk => chunk.toString()), ['current-failure']);
  sink.destroy();

  const sinkFailure = new Error('failure sink unavailable');
  const failingSink = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) { callback(sinkFailure); },
  });
  engine.setDlq(failingSink);
  await assert.rejects(
    engine.stream.pipe(Readable.from([Buffer.from('sink-error')]), destination(), false, { timeoutMs: 0 }),
    error => error === sinkFailure,
  );
  failingSink.destroy();
});

test('source errors retain identity, destroy the destination, and report once', async () => {
  const failure = new Error('source failed');
  async function* chunks() {
    yield Buffer.from('first');
    throw failure;
  }
  const source = Readable.from(chunks());
  const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const errors = [];
  const engine = new DataEngine();
  engine.on('error', error => errors.push(error));

  await assert.rejects(engine.stream.pipe(source, destination), error => error === failure);
  assert.deepEqual(errors, [failure]);
  assert.equal(source.destroyed, true);
  assert.equal(destination.destroyed, true);
});
