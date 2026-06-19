import { randomBytes, createCipheriv, createDecipheriv, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { BasePlugin } from '../core/plugin.js';
import type { ProcessorContext, KmsProvider } from '../core/types.js';

export interface KmsEncryptionOptions {
  kms: KmsProvider;
  keyId: string;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * KmsEncryptionPlugin — Enterprise-grade encryption using Envelope Encryption.
 * 
 * 1. Generate a data key via KMS.
 * 2. Encrypt data locally using the plaintext data key.
 * 3. Prepend the encrypted data key (ciphertext) to the payload.
 * 
 * Packet format: [4B key_len][Encrypted Data Key][12B IV][16B Tag][Ciphertext]
 */
export class KmsEncryptionPlugin extends BasePlugin {
  public readonly name = 'kms-encryption';
  public readonly version = '1.0.0';

  constructor(protected override options: KmsEncryptionOptions) {
    super(options);
  }

  public override async process(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    const { kms, keyId } = this.options;
    
    // 1. Generate Data Key
    const { plaintext, ciphertext: encryptedKey } = await kms.generateDataKey(keyId);
    
    // 2. Encrypt Payload
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', plaintext, iv, { authTagLength: TAG_LENGTH } as any) as CipherGCM;
    
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    
    // 3. Assemble Packet
    const keyLenBuf = Buffer.alloc(4);
    keyLenBuf.writeUInt32BE(encryptedKey.length);
    
    return Buffer.concat([keyLenBuf, encryptedKey, iv, tag, encrypted]);
  }

  public override async reverse(data: Buffer, _ctx: ProcessorContext): Promise<Buffer> {
    const { kms, keyId } = this.options;
    
    if (data.length < 4) throw new Error('[PipeX] KMS Decryption: Packet too short');
    
    const keyLen = data.readUInt32BE(0);
    const encryptedKey = data.subarray(4, 4 + keyLen);
    const iv = data.subarray(4 + keyLen, 4 + keyLen + IV_LENGTH);
    const tag = data.subarray(4 + keyLen + IV_LENGTH, 4 + keyLen + IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(4 + keyLen + IV_LENGTH + TAG_LENGTH);
    
    // 1. Decrypt Data Key via KMS
    const plaintext = await kms.decrypt(encryptedKey, keyId);
    
    // 2. Decrypt Payload
    const decipher = createDecipheriv('aes-256-gcm', plaintext, iv, { authTagLength: TAG_LENGTH } as any) as DecipherGCM;
    decipher.setAuthTag(tag);
    
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
