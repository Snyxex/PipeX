import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { test } from 'node:test';
import {
  DataEngine,
  OperationTimeoutError,
  UnsupportedReverseError,
  WorkerPoolClosedError,
  WorkerPoolCloseError,
  WorkerPoolPlugin,
  WorkerQueueFullError,
  WorkerTaskError,
} from '../../dist/index.mjs';

const filename = new URL('../fixtures/worker.mjs', import.meta.url);

test('worker pool runs caller-owned forward and reverse exports', async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'encode', reverseName: 'decode', maxThreads: 1 });
  try {
    const engine = new DataEngine().use(plugin);
    assert.equal(engine.pluginCapabilities[0].reverse, true);
    assert.equal(engine.pluginCapabilities[0].streamMode, 'native');
    const result = await engine.binary.run(Buffer.from('worker payload'));
    assert.equal((await engine.binary.undo(result)).toString(), 'worker payload');
  } finally {
    await plugin.close();
  }
});

test('worker pool is forward-only unless a reverse export is configured', async () => {
  const plugin = new WorkerPoolPlugin({ filename, maxThreads: 1 });
  try {
    const engine = new DataEngine().use(plugin);
    assert.equal(engine.pluginCapabilities[0].reverse, false);
    assert.equal(engine.pluginCapabilities[0].streamMode, 'native');
    const result = await engine.binary.run(Buffer.from('forward'));
    await assert.rejects(engine.binary.undo(result), UnsupportedReverseError);
  } finally {
    await plugin.close();
  }
});

test('worker failures are typed and preserve their cause', async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'fail', maxThreads: 1 });
  try {
    await assert.rejects(plugin.process(Buffer.from('input'), {}), error => {
      assert.ok(error instanceof WorkerTaskError);
      assert.match(error.cause.message, /fixture worker failure/);
      return true;
    });
  } finally {
    await plugin.close();
  }
});

test('worker task timeout aborts execution and closed pools reject new work', async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'slow', taskTimeoutMs: 10, maxThreads: 1 });
  await assert.rejects(plugin.process(Buffer.from('input'), {}), OperationTimeoutError);
  await plugin.close({ force: true });
  await assert.rejects(plugin.process(Buffer.from('input'), {}), WorkerPoolClosedError);
});

test('running worker tasks honor caller cancellation without hanging', { timeout: 5_000 }, async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'hang', taskTimeoutMs: 0, maxThreads: 1 });
  try {
    const controller = new AbortController();
    const task = plugin.process(Buffer.from('cancel'), { signal: controller.signal });
    controller.abort(new Error('cancelled by caller'));
    await assert.rejects(task, error => {
      assert.equal(error.code, 'OPERATION_ABORTED');
      return true;
    });
  } finally {
    await plugin.close({ force: true });
  }
});

test('destroying a worker stream cancels its active task', { timeout: 5_000 }, async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'hang', taskTimeoutMs: 0, maxThreads: 1 });
  const transform = plugin.createStream('compress');
  const operation = pipeline(
    Readable.from([Buffer.from('stream-task')]),
    transform,
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  );
  await delay(10);
  transform.destroy(new Error('stop stream'));
  await assert.rejects(operation, /stop stream|aborted|premature/i);
  await plugin.close({ force: true });
});

test('worker crashes reject their task and the pool can close without hanging', { timeout: 5_000 }, async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'crash', taskTimeoutMs: 1_000, maxThreads: 1 });
  try {
    await assert.rejects(plugin.process(Buffer.from('crash'), {}), WorkerTaskError);
  } finally {
    await plugin.close({ force: true });
  }
});

test('worker queue is bounded and graceful close drains accepted work', async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'slow', maxThreads: 1, maxQueue: 1 });
  const first = plugin.process(Buffer.from('first'), {});
  const second = plugin.process(Buffer.from('second'), {});
  await assert.rejects(plugin.process(Buffer.from('overflow'), {}), error => {
    assert.ok(error instanceof WorkerQueueFullError);
    assert.equal(error.code, 'WORKER_QUEUE_FULL');
    assert.equal(error.maxQueue, 1);
    return true;
  });
  const closing = plugin.close();
  let concurrentCloseFinished = false;
  const concurrentClose = plugin.close().then(() => { concurrentCloseFinished = true; });
  await assert.rejects(plugin.process(Buffer.from('late'), {}), WorkerPoolClosedError);
  await delay(10);
  assert.equal(concurrentCloseFinished, false);
  assert.equal((await first).toString(), 'first');
  assert.equal((await second).toString(), 'second');
  await Promise.all([closing, concurrentClose]);
});

test('force close rejects running and queued tasks and is idempotent', { timeout: 5_000 }, async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'hang', taskTimeoutMs: 0, maxThreads: 1, maxQueue: 1 });
  const running = plugin.process(Buffer.from('running'), {});
  const queued = plugin.process(Buffer.from('queued'), {});
  const closing = plugin.close({ force: true });
  const results = await Promise.allSettled([running, queued]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.ok(results.every(result => result.reason instanceof WorkerTaskError));
  await closing;
  await plugin.close({ force: true });
  await assert.rejects(plugin.process(Buffer.from('late'), {}), WorkerPoolClosedError);
});

test('graceful close has a bounded deadline and rejects hung tasks', { timeout: 5_000 }, async () => {
  const plugin = new WorkerPoolPlugin({
    filename,
    processName: 'hang',
    taskTimeoutMs: 0,
    closeTimeoutMs: 20,
    maxThreads: 1,
  });
  const task = plugin.process(Buffer.from('hung'), {});
  const taskRejected = assert.rejects(task, WorkerTaskError);
  await assert.rejects(plugin.close(), WorkerPoolCloseError);
  await taskRejected;
  await assert.rejects(plugin.process(Buffer.from('late'), {}), WorkerPoolClosedError);
});

test('worker pool validates queue and worker configuration', async () => {
  assert.throws(() => new WorkerPoolPlugin({}), /requires a worker filename/);
  assert.throws(() => new WorkerPoolPlugin({ filename, maxQueue: 0 }), /positive integer/);
  assert.throws(() => new WorkerPoolPlugin({ filename, maxThreads: 129 }), /cannot exceed 128/);
  assert.throws(() => new WorkerPoolPlugin({ filename, maxQueue: 100_001 }), /cannot exceed 100000/);
  assert.throws(() => new WorkerPoolPlugin({ filename, taskTimeoutMs: 0x8000_0000 }), /timer range/);
  const plugin = new WorkerPoolPlugin({ filename, maxThreads: 1 });
  await assert.rejects(plugin.close({ force: 'yes' }), /force must be a boolean/);
  await plugin.close();
});
