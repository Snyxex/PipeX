import assert from 'node:assert/strict';
import test from 'node:test';
import { Packr } from 'msgpackr';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { DataEngine, PACKR, ValidationPlugin, assertMessagePackFrameLimits } from '../../dist/index.mjs';

const collect = output => new Writable({ objectMode: true, write(value, _, cb) { output.push(value); cb(); } });

test('contextual extensions occupy one complete logical frame', async () => {
  for (const value of [new Set(['x'.repeat(100)]), new Error('x'.repeat(100)), /xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/g]) {
    const frame = new Packr({ useRecords: false, moreTypes: true }).pack(value);
    assert.equal(assertMessagePackFrameLimits(frame, frame.length, 1), 1);
    assert.throws(() => assertMessagePackFrameLimits(frame, frame.length - 1, 1), /frame exceeds/);
    const manifest = PACKR.pack({ __pipex_v: 1, plugins: [], ts: 0 });
    const bytes = Buffer.concat([manifest, frame]);
    const output = [];
    const engine = new DataEngine({ maxFrameBytes: Math.max(manifest.length, frame.length), maxFrames: 1 });
    await pipeline(Readable.from([...bytes].map(byte => Buffer.from([byte]))), engine.stream.unpack(), collect(output));
    assert.equal(output.length, 1);
    if (value instanceof Error) assert.equal(output[0].message, value.message);
    else assert.deepEqual(output[0], value);
    const tooSmall = new DataEngine({ maxFrameBytes: frame.length - 1, maxFrames: 1 });
    await assert.rejects(pipeline(Readable.from([bytes]), tooSmall.stream.unpack(), collect([])), /frame exceeds/);
  }
});

test('scanner rejects structured references and unregistered extension semantics', () => {
  for (const type of [0x69, 0x70, 0x62, 0x72, 0x13]) {
    assert.throws(() => assertMessagePackFrameLimits(Buffer.from([0xd4, type, 0]), 100, 1), /Invalid MessagePack/);
  }
  assert.throws(() => assertMessagePackFrameLimits(Buffer.from([0xd4, 0x73, 0]), 100, 1), /incomplete frame/);
});

test('validation reverse bypass is identical for buffers and fragmented streams', async () => {
  const plugin = new ValidationPlugin({ schema: z.never(), validateOnReverse: false });
  const encoded = PACKR.pack({ id: 7 });
  assert.deepEqual(await plugin.reverse(encoded, { requestId: 'test' }), encoded);
  const output = [];
  await pipeline(Readable.from([...encoded].map(byte => Buffer.from([byte]))), plugin.createStream('decompress'), collect(output));
  assert.deepEqual(Buffer.concat(output), encoded);
  await assert.rejects(pipeline(Readable.from([encoded]), plugin.createStream('compress'), collect([])), /Validation failed/);
});

test('validation checks MessagePack frame limits before schema decoding', async () => {
  const plugin = new ValidationPlugin({ schema: z.any() });
  const encoded = PACKR.pack({ payload: 'x'.repeat(64) });
  const limits = new DataEngine({ maxFrameBytes: 32 }).limits;
  await assert.rejects(plugin.process(encoded, { requestId: 'test', limits }), /frame exceeds/);
  await assert.rejects(pipeline(Readable.from([encoded]), plugin.createStream('compress', { requestId: 'test', limits }), collect([])), /frame exceeds/);
});


test('PipeX writers preserve the supported contextual extension types', async () => {
  for (const value of [new Set([1, 2]), /payload/gi, new Error('payload')]) {
    const engine = new DataEngine();
    const result = await engine.binary.run(value);
    const restored = await engine.binary.undo(result);
    assert.equal(restored.constructor, value.constructor);
    if (value instanceof Error) assert.equal(restored.message, value.message);
    else assert.deepEqual(restored, value);
    const output = [];
    await pipeline(Readable.from([value]), engine.stream.pack(), engine.stream.unpack(), collect(output));
    assert.equal(output[0].constructor, value.constructor);
  }
});
