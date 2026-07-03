import { DataEngine } from '../src/core/dataEngine.js';
import { KmsEncryptionPlugin } from '../src/plugin/kms_encryption.js';
import type { AuditLogger, AuditRecord, KmsProvider } from '../src/core/types.js';
import { randomBytes } from 'node:crypto';

class MockAuditLogger implements AuditLogger {
  records: AuditRecord[] = [];
  log(record: AuditRecord) { this.records.push(record); }
}

class MockKmsProvider implements KmsProvider {
  async generateDataKey(_keyId: string) {
    return {
      plaintext: randomBytes(32),
      ciphertext: Buffer.from('encrypted-key-blob'),
    };
  }
  async encrypt(data: Buffer, _keyId: string) { return data; }
  async decrypt(data: Buffer, _keyId: string) {
    if (data.toString() === 'encrypted-key-blob') return randomBytes(32); // Return dummy key
    return data;
  }
}

async function testSecurity() {
  console.log('Testing Security (Audit & KMS)...');
  
  const engine = new DataEngine();
  const audit = new MockAuditLogger();
  const kms = new MockKmsProvider();
  
  engine.setAuditLogger(audit);
  
  // Use KMS Encryption
  engine.use(new KmsEncryptionPlugin({ kms, keyId: 'alias/pipex' }));

  const input = { sensitive: 'data' };
  await engine.binary.run(input);
  
  // Verify Audit
  if (audit.records.length === 0) {
    throw new Error('Audit logger should have captured the operation');
  }
  const lastRecord = audit.records[0];
  if (!lastRecord) {
    throw new Error('Audit logger should have captured at least one record');
  }
  if (lastRecord.operation !== 'process') {
    throw new Error(`Unexpected audit operation: ${lastRecord.operation}`);
  }
  console.log('✅ Audit test passed!');

  // Verify KMS (round-trip)
  // MockKms.decrypt needs to return the SAME plaintext for success.
  // Let's refine the mock to be more realistic.
}

// Improved Mock for round-trip
class RealMockKms implements KmsProvider {
  keys = new Map<string, Buffer>();
  async generateDataKey(_keyId: string) {
    const plaintext = randomBytes(32);
    const ciphertext = Buffer.from(`cipher-${randomUUID()}`);
    this.keys.set(ciphertext.toString(), plaintext);
    return { plaintext, ciphertext };
  }
  async encrypt(data: Buffer, _keyId: string) { return data; }
  async decrypt(data: Buffer, _keyId: string) {
    const key = this.keys.get(data.toString());
    if (!key) throw new Error('KMS Decryption failed');
    return key;
  }
}

import { randomUUID } from 'node:crypto';

async function testSecurityFull() {
  const engine = new DataEngine();
  const kms = new RealMockKms();
  engine.use(new KmsEncryptionPlugin({ kms, keyId: 'alias/pipex' }));

  const input = { secret: 'enterprise-data' };
  const result = await engine.binary.run(input);
  const restored = await engine.binary.undo(result);

  if (JSON.stringify(input) !== JSON.stringify(restored)) {
    throw new Error('KMS Round-trip failed');
  }
  console.log('✅ KMS Encryption test passed!');
}

testSecurity().then(() => testSecurityFull()).catch(e => {
  console.error('❌ Security test failed:', e);
  process.exit(1);
});
