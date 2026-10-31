import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
 PipeXError, ValidationError, CompressionError, EncryptionError,
 HashingError, PipelineAbortedError, UnsupportedAlgorithmError,
 OperationAbortedError, DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin,
} from '../../dist/index.mjs';

const cases = [
 [ValidationError, 'VALIDATION_FAILED', 'ValidationError'],
 [CompressionError, 'COMPRESSION_FAILED', 'CompressionError'],
 [EncryptionError, 'ENCRYPTION_FAILED', 'EncryptionError'],
 [HashingError, 'HASHING_FAILED', 'HashingError'],
 [PipelineAbortedError, 'OPERATION_ABORTED', 'PipelineAbortedError'],
 [UnsupportedAlgorithmError, 'UNSUPPORTED_ALGORITHM', 'UnsupportedAlgorithmError'],
];
for (const [ErrorType, code, stableName] of cases) {
 test(stableName + ' exposes stable typed metadata without secret input', () => {
  const error = new ErrorType({ transformName: 'test-transform', stage: 'process' });
  assert.ok(error instanceof Error);
  assert.ok(error instanceof PipeXError);
  assert.equal(error.name, stableName);
  assert.equal(error.code, code);
  assert.equal(error.transformName, 'test-transform');
  assert.equal(error.stage, 'process');
  assert.ok(error.message);
  assert.doesNotMatch(error.message, /secret|plaintext-value|passphrase/);
  assert.equal(error.cause, undefined);
 });
}
test('typed errors expose an optional safe cause', () => {
 const cause = new Error('sanitized cause');
 const error = new CompressionError({ cause, stage: 'decompress' });
 assert.equal(error.cause, cause);
});
test('legacy abort remains a pipeline-abort subtype', () => {
 const error = new OperationAbortedError();
 assert.ok(error instanceof PipelineAbortedError);
 assert.equal(error.code, 'OPERATION_ABORTED');
});
test('unsupported algorithms are typed and do not disclose provided values', () => {
 assert.throws(() => new CompressionPlugin({ type: 'secret-unknown-algorithm' }), UnsupportedAlgorithmError);
 assert.throws(() => new HashingPlugin({ algorithm: 'secret-unknown-algorithm', secret: 'an-extremely-long-secret' }), UnsupportedAlgorithmError);
 assert.throws(() => new EncryptionPlugin({ algorithm: 'secret-unknown-algorithm', key: Buffer.alloc(32) }), UnsupportedAlgorithmError);
});
test('hashing verification failure propagates through the binary pipeline', async () => {
 const engine = new DataEngine().use(new HashingPlugin({ algorithm: 'sha256', secret: 'test-secret-long-enough' }));
 const processed = await engine.binary.run(Buffer.from('plaintext-value'));
 const tampered = Buffer.from(processed.data);
 tampered[tampered.length - 1] ^= 1;
 await assert.rejects(engine.binary.undo(tampered, 'buffer'), error => {
  assert.ok(error instanceof HashingError);
  assert.equal(error.code, 'HASHING_FAILED');
  assert.doesNotMatch(error.message, /plaintext-value|test-secret-long-enough/);
  return true;
 });
});
test('configured pipeline validation propagates typed errors', async () => {
 const engine = new DataEngine().use(new CompressionPlugin({type: 'none'}));
 await assert.rejects(engine.binary.undo(Buffer.alloc(0), 'buffer'), error => {
  assert.ok(error instanceof CompressionError);
  return true;
 });
});
