import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DataEngine, EncryptionPlugin, HashingPlugin, CompressionPlugin, OperationTimeoutError, OperationAbortedError } from '../../dist/index.mjs';

for (const combination of ['E', 'EH', 'CEH']) test('untrusted type metadata cannot expose plaintext: ' + combination, async () => {
  const logged = [];
  const engine = new DataEngine().setLogger({ info() {}, warn() {}, debug() {}, error(_m, c) { logged.push(c); } });
  if (combination.includes('C')) engine.use(new CompressionPlugin({ type: 'gzip' }));
  engine.use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: randomBytes(32) }));
  if (combination.includes('H')) engine.use(new HashingPlugin({ algorithm: 'sha256', secret: 'separate-secret-at-least-16' }));
  for (const secret of ['s3cr3t', 'private payload '.repeat(100)]) {
    const result = await engine.binary.run(secret);
    for (const originalType of ['json', 'null', 'undefined', 'invented']) {
      await assert.rejects(engine.binary.undo({ ...result, originalType }), error => {
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
    const received = { ...result, data: Buffer.from(result.data) };
    await assert.rejects(engine.binary.undo(received), /trusted expectedType/);
    assert.equal(await engine.binary.undo(received, { expectedType: 'string' }), secret);
    await assert.rejects(engine.binary.undo(result.data, 'json'), error => {
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(JSON.stringify(logged).includes(secret), false);
  }
});

test('invalid result objects and broken tracer hooks cannot consume capacity', async () => {
  const engine = new DataEngine({ maxConcurrentOperations: 1 }).setTracer({ startSpan() { throw new Error('observer'); } });
  for (const data of [null, undefined, {}, 'buffer']) await assert.rejects(engine.binary.undo({ data, originalType: 'buffer' }), /Invalid EngineResult/);
  const valid = await engine.binary.run('healthy');
  assert.equal(await engine.binary.undo(valid), 'healthy');
});

test('deadline rejects promptly and preserves capacity until non-cooperative work settles', async () => {
  let finish;
  let calls = 0;
  const engine = new DataEngine({ maxConcurrentOperations: 1 }).use({
    name: 'deferred', version: '1', process(data) { calls++; return new Promise(resolve => { finish = () => resolve(data); }); },
  });
  await assert.rejects(engine.binary.run('pending', { timeoutMs: 10 }), OperationTimeoutError);
  await assert.rejects(engine.binary.run('second', { timeoutMs: 10 }), /concurrent operations/);
  assert.equal(calls, 1);
  finish();
  await delay(0);
  const next = engine.binary.run('recovered', { timeoutMs: 1000 });
  finish();
  await next;
});

test('pre-aborted empty pipelines and synchronous deadline overruns never succeed', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new DataEngine().binary.run('x', { signal: controller.signal }), OperationAbortedError);
  const engine = new DataEngine().use({ name: 'sync', version: '1', process(data) { const until = Date.now() + 20; while (Date.now() < until) {} return data; } });
  await assert.rejects(engine.binary.run('x', { timeoutMs: 1 }), OperationTimeoutError);
});

test('binary bounds apply without plugins and before object decoding', async () => {
  const smallOutput = new DataEngine({ maxOutputBytes: 1 });
  await assert.rejects(smallOutput.binary.run(Buffer.alloc(32)), /Output exceeds/);
  await assert.rejects(smallOutput.binary.undo(Buffer.alloc(32), 'buffer'), /Output exceeds/);
  const frameBound = new DataEngine({ maxFrameBytes: 32 });
  await assert.rejects(frameBound.binary.run({ payload: 'x'.repeat(100) }), /frame exceeds/);
  const encoded = new DataEngine().binary.pack({ payload: 'x'.repeat(100) });
  await assert.rejects(frameBound.binary.undo(encoded, 'object'), /frame exceeds/);
});

test('result and audit describe the executed chain despite end-listener reconfiguration', async () => {
  const audits = [];
  const engine = new DataEngine().setAuditLogger({ log(record) { audits.push(record); } });
  engine.once('end', () => engine.use(new HashingPlugin({ algorithm: 'sha256', secret: 'separate-secret-at-least-16' })));
  const result = await engine.binary.run('plain');
  assert.deepEqual(result.pipeline, []);
  assert.deepEqual(audits[0].pluginChain, []);
  assert.equal(engine.pipeline.length, 1);
});


test('native gzip cannot report success beyond the binary deadline', async () => {
  const input = randomBytes(8 * 1024 * 1024);
  const engine = new DataEngine({ maxInputBytes: input.length, maxOutputBytes: input.length * 2 })
    .use(new CompressionPlugin({ type: 'gzip' }));
  await assert.rejects(engine.binary.run(input, { timeoutMs: 1 }), OperationTimeoutError);
});
