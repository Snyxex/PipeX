import { CompressionPlugin, EncryptionPlugin, HashingPlugin, DataEngine } from '../../src/index.js';
import type { CompressionOptions, EncryptionOptions, HashingOptions, EngineResult } from '../../src/index.js';

const compression: CompressionOptions = { type: 'brotli', level: 5 };
const encryption: EncryptionOptions = { algorithm: 'aes-256-gcm', key: Buffer.alloc(32) };
const hashing: HashingOptions = { algorithm: 'sha256', secret: 'a long secret for tests' };
new CompressionPlugin(compression);
new EncryptionPlugin(encryption);
new HashingPlugin(hashing);
const engine = new DataEngine();
const promise: Promise<EngineResult> = engine.binary.run(Buffer.from('input'));
void promise;
// @ts-expect-error an unknown compression identifier must fail type checking
new CompressionPlugin({ type: 'invalid' });
// @ts-expect-error incorrect algorithm identifiers must fail type checking
new EncryptionPlugin({ algorithm: 'aes-128-gcm', key: Buffer.alloc(32) });
// @ts-expect-error HMAC only accepts sha256 or sha512
new HashingPlugin({ algorithm: 'md5', secret: 'a long secret for tests' });
