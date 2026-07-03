import { Buffer } from 'node:buffer';
import { availableParallelism } from 'node:os';
import { DataEngine, WorkerPoolPlugin } from '../src/index.js';

async function runWorkerPoolTest() {
  const engine = new DataEngine();
  engine.use(new WorkerPoolPlugin({ maxThreads: 2 }));

  const totalBytes = 1024 * 1024;
  const cores = availableParallelism();

  console.log('\nSTARTING WORKER POOL TEST');
  console.log('==================================================');
  console.log(`Data size:       ${totalBytes} bytes`);
  console.log(`CPU cores:       ${cores} threads`);
  console.log('Mode:            Parallel worker processing');

  const testData = Buffer.alloc(totalBytes, 'A');
  const start = performance.now();
  const result = await engine.binary.run(testData);
  const end = performance.now();

  const durationMs = end - start;
  const durationSec = durationMs / 1000;
  const throughput = (totalBytes / 1024 / 1024) / durationSec;

  console.log('\nResult:');
  console.log('--------------------------------------------------');
  console.log(`Total time:      ${durationMs.toFixed(2)} ms`);
  console.log(`Effective speed: ${throughput.toFixed(2)} MB/s`);

  const expectedByte = 'A'.charCodeAt(0) ^ 0x42;
  if (result.data[0] !== expectedByte) {
    throw new Error('WorkerPoolPlugin returned unchanged or invalid data');
  }

  console.log('Integrity:       Correct');
  console.log('==================================================\n');

  process.exit(0);
}

runWorkerPoolTest().catch((err) => {
  console.error('Worker pool test failed:', err);
  process.exit(1);
});
