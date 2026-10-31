/** Optional WorkerPoolPlugin uses a caller-owned ESM worker module. */
import assert from 'node:assert/strict';
import { DataEngine, CompressionPlugin, WorkerPoolPlugin } from '../dist/index.mjs';

const worker = new WorkerPoolPlugin({
  filename: new URL('./worker-transform.mjs', import.meta.url),
  processName: 'encode',
  reverseName: 'decode',
  maxThreads: 1,
});
try {
  const engine = new DataEngine()
    .use(new CompressionPlugin({ type: 'gzip' }))
    .use(worker);
  const source = Buffer.from('worker pipeline '.repeat(100));
  const encoded = await engine.binary.run(source);
  assert.deepEqual(await engine.binary.undo(encoded), source);
  console.log('Worker-based pipeline OK');
} finally {
  await worker.close();
}
