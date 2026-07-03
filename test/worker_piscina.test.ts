import { WorkerPoolPlugin } from '../src/plugin/worker.js';
import { DataEngine } from '../src/core/dataEngine.js';

async function testWorkerPiscina() {
  console.log('Testing WorkerPoolPlugin with Piscina...');
  
  const engine = new DataEngine();
  engine.use(new WorkerPoolPlugin({ maxThreads: 2 }));

  const input = Buffer.from('Hello Piscina');
  const result = await engine.binary.run(input);
  
  // XOR with 0x42 twice should return the original string
  const restored = await engine.binary.undo<Buffer>(result);
  
  if (restored.toString() !== 'Hello Piscina') {
    throw new Error(`Worker transformation failed. Expected "Hello Piscina", got "${restored.toString()}"`);
  }
  
  console.log('✅ WorkerPoolPlugin test passed!');
  process.exit(0);
}

testWorkerPiscina().catch(e => {
  console.error('❌ WorkerPoolPlugin test failed:', e);
  process.exit(1);
});
