/** Handle stable PipeX error codes and AbortSignal without exposing payloads. */
import assert from 'node:assert/strict';
import { DataEngine, CompressionPlugin, OperationAbortedError, PipeXError, UnsupportedAlgorithmError } from '../dist/index.mjs';

try {
  new CompressionPlugin({ type: 'not-an-algorithm' });
  throw new Error('Expected unsupported algorithm failure');
} catch (error) {
  assert.ok(error instanceof UnsupportedAlgorithmError);
  if (error instanceof PipeXError) {
    console.log('Caught typed failure:', error.code);
  }
}
const abort = new AbortController();
abort.abort();
const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip' }));
await assert.rejects(engine.binary.run(Buffer.from('private input'), { signal: abort.signal }), error => {
  assert.ok(error instanceof OperationAbortedError);
  return true;
});
console.log('AbortSignal handling OK');
