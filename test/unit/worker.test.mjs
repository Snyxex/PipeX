import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DataEngine,
  OperationTimeoutError,
  UnsupportedReverseError,
  WorkerPoolClosedError,
  WorkerPoolPlugin,
  WorkerTaskError,
} from '../../dist/index.mjs';

const filename = new URL('../fixtures/worker.mjs', import.meta.url);

test('worker pool runs caller-owned forward and reverse exports', async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'encode', reverseName: 'decode', maxThreads: 1 });
  try {
    const engine = new DataEngine().use(plugin);
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

test('worker queue is bounded and graceful close drains accepted work', async () => {
  const plugin = new WorkerPoolPlugin({ filename, processName: 'slow', maxThreads: 1, maxQueue: 1 });
  const first = plugin.process(Buffer.from('first'), {});
  const second = plugin.process(Buffer.from('second'), {});
  await assert.rejects(plugin.process(Buffer.from('overflow'), {}), WorkerTaskError);
  const closing = plugin.close();
  assert.equal((await first).toString(), 'first');
  assert.equal((await second).toString(), 'second');
  await closing;
});

test('worker pool validates queue and worker configuration', () => {
  assert.throws(() => new WorkerPoolPlugin({}), /requires a worker filename/);
  assert.throws(() => new WorkerPoolPlugin({ filename, maxQueue: 0 }), /positive integer/);
});
