import { describe, it, expect } from 'vitest';
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from '../../src/index.js';

describe('invalid public input and error confidentiality', () => {
  it('rejects invalid compression options', () => {
    expect(() => new CompressionPlugin({ type: 'gzip', level: 999 })).toThrow();
  });
  it('rejects incorrect encryption key lengths without disclosing key data', () => {
    const key = Buffer.from('invalid-secret-key');
    expect(() => new EncryptionPlugin({ algorithm: 'aes-256-gcm', key })).toThrow();
    try {
      new EncryptionPlugin({ algorithm: 'aes-256-gcm', key });
    } catch (error) {
      expect(String(error)).not.toContain(key.toString());
    }
  });
  it('does not disclose the HMAC secret on validation failure', () => {
    const secret = 'not enough';
    try {
      new HashingPlugin({ algorithm: 'sha256', secret });
      throw new Error('expected constructor failure');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
  it('rejects untrusted invalid serialized input', () => {
    const engine = new DataEngine();
    expect(() => engine.binary.unpack(Buffer.from([0xc1]))).toThrow();
  });
});
