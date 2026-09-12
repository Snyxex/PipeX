import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { DataEngine } from '../../dist/index.mjs';

test('retry succeeds on the configured attempt', async () => {
  let attempts = 0;
  const engine = new DataEngine().use({
    name: 'flaky',
    version: '1.0.0',
    retryOptions: { attempts: 3, backoff: 'fixed', delayMs: 1 },
    process(data) {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return data;
    },
  });
  await engine.binary.run(Buffer.from('retry'));
  assert.equal(attempts, 3);
});

test('retry exhaustion rejects and writes the failed stream chunk to DLQ', async () => {
  const dlq = new PassThrough();
  const chunks = [];
  dlq.on('data', chunk => chunks.push(chunk));
  const engine = new DataEngine().setDlq(dlq).use({
    name: 'always-fails',
    version: '1.0.0',
    retryOptions: { attempts: 2, backoff: 'fixed', delayMs: 1 },
    process() { throw new Error('permanent'); },
  });
  await assert.rejects(
    engine.stream.pipe(
      Readable.from([Buffer.from('poison')]),
      new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    ),
    /permanent/,
  );
  assert.equal(Buffer.concat(chunks).toString(), 'poison');
  dlq.destroy();
});

test('aborted retry delay rejects promptly', { timeout: 5_000 }, async () => {
  const controller = new AbortController();
  const engine = new DataEngine().use({
    name: 'slow-retry',
    version: '1.0.0',
    retryOptions: { attempts: 3, backoff: 'fixed', delayMs: 1_000 },
    process() { throw new Error('retry'); },
  });
  setTimeout(() => controller.abort(), 20).unref();
  const started = Date.now();
  await assert.rejects(engine.binary.run(Buffer.from('cancel'), { signal: controller.signal }), /abort/i);
  assert.ok(Date.now() - started < 500);
});
