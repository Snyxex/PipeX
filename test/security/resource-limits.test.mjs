import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import {
  CompressionPlugin,
  DataEngine,
  EncryptionPlugin,
  HashingPlugin,
  KmsEncryptionPlugin,
  PACKR,
  ValidationPlugin,
} from '../../dist/index.mjs';

const sink = chunks => new Writable({
  objectMode: true,
  write(chunk, _encoding, callback) {
    chunks.push(chunk);
    callback();
  },
});

const limits = overrides => ({
  maxInputBytes: 1024,
  maxOutputBytes: 1024,
  maxFrameBytes: 1024,
  maxFrames: 10,
  operationTimeoutMs: 0,
  ...overrides,
});

test('binary frame limits accept below and exactly at the encoded boundary', () => {
  const value = Buffer.alloc(32, 0x5a);
  const encoded = PACKR.pack(value);

  const below = new DataEngine(limits({ maxFrameBytes: encoded.length + 1 }));
  const exact = new DataEngine(limits({ maxFrameBytes: encoded.length }));
  assert.deepEqual(below.binary.unpack(encoded), value);
  assert.deepEqual(exact.binary.unpack(encoded), value);

  const over = new DataEngine(limits({ maxFrameBytes: encoded.length - 1 }));
  assert.throws(() => over.binary.unpack(encoded), /MessagePack frame exceeds/);
});

test('fragmented legal frames are checked at their actual boundaries', async () => {
  const manifest = PACKR.pack({ __pipex_v: 1, plugins: [], ts: 0 });
  const value = { id: 7, payload: 'x'.repeat(40) };
  const data = PACKR.pack(value);
  const encoded = Buffer.concat([manifest, data]);
  const fragments = [...encoded].map(byte => Buffer.from([byte]));
  const output = [];
  const engine = new DataEngine(limits({
    maxInputBytes: encoded.length,
    maxFrameBytes: Math.max(manifest.length, data.length),
    maxFrames: 1,
  }));

  await pipeline(Readable.from(fragments), engine.stream.unpack(), sink(output));
  assert.deepEqual(output, [value]);
});

test('manipulated and fragmented length headers fail before payload parsing', async () => {
  const cases = [
    Buffer.from([0xc6, 0x00, 0x00, 0x01, 0x00]), // bin32 claims 256 bytes
    Buffer.from([0xdb, 0xff, 0xff, 0xff, 0xff]), // str32 claims UINT32_MAX
    Buffer.from([0xdf, 0xff, 0xff, 0xff, 0xff]), // map32 implies 2 * UINT32_MAX children
  ];

  for (const header of cases) {
    const engine = new DataEngine(limits({ maxInputBytes: 64, maxFrameBytes: 32 }));
    const fragments = [...header].map(byte => Buffer.from([byte]));
    await assert.rejects(
      pipeline(Readable.from(fragments), engine.stream.unpack(), sink([])),
      /MessagePack frame exceeds 32 bytes/,
    );
  }

  const truncated = new DataEngine(limits({ maxInputBytes: 64, maxFrameBytes: 32 }));
  await assert.rejects(
    pipeline(Readable.from([Buffer.from([0xc6, 0x00, 0x00])]), truncated.stream.unpack(), sink([])),
    /incomplete frame/,
  );

  const structuralExtension = new DataEngine(limits({ maxInputBytes: 64, maxFrameBytes: 32 }));
  await assert.rejects(
    pipeline(
      Readable.from([Buffer.from([0xd4]), Buffer.from([0x72]), Buffer.from([0x00])]),
      structuralExtension.stream.unpack(),
      sink([]),
    ),
    /Invalid MessagePack input/,
  );
});

test('stream packing enforces frame and application-frame limits', async () => {
  const value = { payload: 'x'.repeat(128) };
  const encodedValue = PACKR.pack(value);
  const tooSmall = new DataEngine(limits({ maxFrameBytes: encodedValue.length - 1 }));
  await assert.rejects(
    pipeline(Readable.from([value]), tooSmall.stream.pack(), sink([])),
    /MessagePack frame exceeds/,
  );

  const oneFrame = new DataEngine(limits({ maxFrameBytes: 512, maxFrames: 1 }));
  await pipeline(Readable.from([value]), oneFrame.stream.pack(), sink([]));
  const twoFrames = new DataEngine(limits({ maxFrameBytes: 512, maxFrames: 1 }));
  await assert.rejects(
    pipeline(Readable.from([value, value]), twoFrames.stream.pack(), sink([])),
    /Application frame count exceeds 1/,
  );
});

test('aggregate byte limits accept exact input and reject one byte above before forwarding', async () => {
  const exactOutput = [];
  const exact = new DataEngine(limits({ maxInputBytes: 8, maxOutputBytes: 8 }));
  await exact.stream.pipe(Readable.from([Buffer.alloc(8)]), sink(exactOutput));
  assert.equal(exactOutput[0].length, 8);

  const rejectedOutput = [];
  const over = new DataEngine(limits({ maxInputBytes: 8, maxOutputBytes: 8 }));
  await assert.rejects(
    over.stream.pipe(Readable.from([Buffer.alloc(9)]), sink(rejectedOutput)),
    /input exceeds 8 bytes/,
  );
  assert.equal(rejectedOutput.length, 0);
});

test('engine limits reject invalid integers and cannot be mutated in place', () => {
  for (const maxFrameBytes of [-1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new DataEngine({ maxFrameBytes }), /Invalid engine limit|must be positive/);
  }

  const engine = new DataEngine(limits({ maxFrameBytes: 64 }));
  assert.equal(Object.isFrozen(engine.limits), true);
  assert.throws(() => { engine.limits.maxFrameBytes = 1024; }, TypeError);
  assert.equal(engine.limits.maxFrameBytes, 64);
});

test('engine limits cannot change while a request is active', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const engine = new DataEngine(limits({ maxConcurrentOperations: 1 })).use({
    name: 'waiting',
    version: '1.0.0',
    async process(data) { await waiting; return data; },
  });

  const operation = engine.binary.run(Buffer.from('x'));
  assert.throws(() => engine.setLimits({ maxInputBytes: 2048 }), /operations are active/);
  release();
  await operation;
});

test('standard plugins enforce request limits before expensive or copying work', async () => {
  const input = Buffer.from('data');
  const context = (maxOutputBytes, maxInputBytes = 256) => ({
    requestId: 'limits',
    timestamp: 0,
    metadata: {},
    limits: limits({ maxInputBytes, maxOutputBytes }),
  });

  const encryption = new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: randomBytes(32) });
  assert.equal((await encryption.process(input, context(input.length + 29))).length, input.length + 29);
  await assert.rejects(encryption.process(input, context(input.length + 28)), /Encryption output exceeds/);

  const hashing = new HashingPlugin({ algorithm: 'sha256', secret: '0123456789abcdef' });
  assert.equal((await hashing.process(input, context(input.length + 32))).length, input.length + 32);
  await assert.rejects(hashing.process(input, context(input.length + 31)), /Hashing output exceeds/);

  const compression = new CompressionPlugin({ type: 'none' });
  assert.equal((await compression.process(input, context(input.length + 1))).length, input.length + 1);
  await assert.rejects(compression.process(input, context(input.length)), /Compression output exceeds/);

  let parsed = false;
  const validation = new ValidationPlugin({ schema: { safeParse() { parsed = true; return { success: true }; } } });
  await assert.rejects(validation.process(PACKR.pack('sensitive-value'), context(4, 256)), /Validation input exceeds 4 bytes/);
  assert.equal(parsed, false);
});

test('KMS rejects impossible output sizes before contacting the provider', async () => {
  let called = false;
  const plugin = new KmsEncryptionPlugin({
    keyId: 'key',
    kms: {
      async generateDataKey() { called = true; throw new Error('provider secret'); },
      async encrypt(data) { return data; },
      async decrypt() { return Buffer.alloc(32); },
    },
  });

  await assert.rejects(
    plugin.process(Buffer.from('secret-input'), {
      requestId: 'kms-limit',
      timestamp: 0,
      metadata: {},
      limits: limits({ maxInputBytes: 64, maxOutputBytes: 16 }),
    }),
    error => {
      assert.match(error.message, /KMS encryption output exceeds 16 bytes/);
      assert.doesNotMatch(error.message, /secret-input|provider secret/);
      return true;
    },
  );
  assert.equal(called, false);
});

test('compression expansion is stopped by the request output limit', async () => {
  const source = Buffer.alloc(4096, 0x41);
  const packet = Buffer.concat([Buffer.from([1]), gzipSync(source)]);
  const plugin = new CompressionPlugin({ type: 'gzip' });

  await assert.rejects(
    plugin.reverse(packet, {
      requestId: 'compression-limit',
      timestamp: 0,
      metadata: {},
      limits: limits({ maxInputBytes: packet.length, maxOutputBytes: 1024 }),
    }),
    error => {
      assert.doesNotMatch(error.message, /AAAA|secret/);
      return true;
    },
  );
});
