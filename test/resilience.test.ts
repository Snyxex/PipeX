import { DataEngine } from '../src/core/dataEngine.js';
import { BasePlugin } from '../src/core/plugin.js';
import { PassThrough } from 'node:stream';
import type { ProcessorContext } from '../src/core/types.js';

class FlakyPlugin extends BasePlugin {
  name = 'flaky';
  version = '1.0.0';
  attempts = 0;
  
  constructor(private failUntil: number) {
    super();
    this.retryOptions = { attempts: 3, backoff: 'fixed', delayMs: 10 };
  }

  process(data: Buffer, _ctx: ProcessorContext) {
    this.attempts++;
    if (this.attempts < this.failUntil) {
      throw new Error(`Flaky failure ${this.attempts}`);
    }
    return data;
  }
}

async function testResilience() {
  console.log('Testing Resilience (Retries)...');
  
  // 1. Test successful retry
  const engine1 = new DataEngine();
  const plugin1 = new FlakyPlugin(3); // Fails twice, succeeds on 3rd
  engine1.use(plugin1);
  
  await engine1.binary.run({ test: 'retry' });
  if (plugin1.attempts !== 3) {
    throw new Error(`Expected 3 attempts, got ${plugin1.attempts}`);
  }
  console.log('✅ Retry test passed!');

  // 2. Test DLQ
  console.log('Testing DLQ...');
  const engine2 = new DataEngine();
  const plugin2 = new FlakyPlugin(10); // Fails all 3 retries
  engine2.use(plugin2);
  
  const dlq = new PassThrough();
  const dlqChunks: Buffer[] = [];
  dlq.on('data', chunk => dlqChunks.push(chunk));
  engine2.setDlq(dlq);

  // We need to use a streaming method for DLQ to trigger in buildFallbackTransform
  const input = new PassThrough();
  const output = new PassThrough();
  
  const pipePromise = engine2.stream.pipe(input, output);
  input.write(Buffer.from('poison pill'));
  input.end();
  
  await pipePromise;
  
  if (dlqChunks.length === 0) {
    throw new Error('DLQ should have received the failed chunk');
  }
  if (dlqChunks[0].toString() !== 'poison pill') {
    throw new Error(`Unexpected DLQ chunk: ${dlqChunks[0].toString()}`);
  }
  
  console.log('✅ DLQ test passed!');
}

testResilience().catch(e => {
  console.error('❌ Resilience test failed:', e);
  process.exit(1);
});
