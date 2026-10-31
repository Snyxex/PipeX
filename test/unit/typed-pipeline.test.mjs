import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typedPipeline, OperationAbortedError } from '../../dist/index.mjs';

test('typed pipeline preserves sequential sync and async transforms', async () => {
  const pipeline = typedPipeline((text) => text.length)
    .pipe(async length => length * 2)
    .pipe(value => ({ result: value }));
  assert.deepEqual(await pipeline.run('abc'), { result: 6 });
});
test('typed pipeline rejects pre-aborted execution', async () => {
  const controller = new AbortController();
  controller.abort();
  const pipeline = typedPipeline(value => value);
  await assert.rejects(pipeline.run('no', {signal: controller.signal}), OperationAbortedError);
});
test('typed pipeline rejects cancellation of an active async transform', async () => {
  const controller = new AbortController();
  const pipeline = typedPipeline(async value => {
    controller.abort();
    return value;
  });
  await assert.rejects(pipeline.run('no', {signal: controller.signal}), OperationAbortedError);
});
