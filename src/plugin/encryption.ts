import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes 
} from 'crypto';
// Expliziter Typ-only Import für die Interfaces
import type { CipherGCM, DecipherGCM } from 'crypto';
import { Transform } from 'stream';
import { BasePlugin } from '../core/plugin';
import type { ProcessorContext } from '../core/types';

export type EncryptionType = 'aes-256-gcm' | 'chacha20-poly1305';

interface EncryptionOptions {
  type: EncryptionType;
  key: Buffer;
}

export class EncryptionPlugin extends BasePlugin {
  public readonly name = 'encryption-provider';
  public readonly version = '2.1.2';

  private readonly typeMap: Record<EncryptionType, number> = {
    'aes-256-gcm': 1,
    'chacha20-poly1305': 2
  };

  constructor(protected options: EncryptionOptions) {
    super(options);
    if (options.key.length !== 32) {
      throw new Error(`[${this.name}] Key must be exactly 32 bytes.`);
    }
  }

  public async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const iv = randomBytes(12);
    // Erstellen des Ciphers und Type-Casting zu CipherGCM
    const cipher = createCipheriv(this.options.type, this.options.key, iv, { authTagLength: 16 } as any) as CipherGCM;

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();

    const header = Buffer.alloc(1);
    header.writeUInt8(this.typeMap[this.options.type]);

    return Buffer.concat([header, iv, tag, encrypted]);
  }

  public async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const typeId = data.readUInt8(0);
    const iv = data.subarray(1, 13);
    const tag = data.subarray(13, 29);
    const encryptedData = data.subarray(29);

    const algo = typeId === 1 ? 'aes-256-gcm' : 'chacha20-poly1305';
    const decipher = createDecipheriv(algo, this.options.key, iv, { authTagLength: 16 } as any) as DecipherGCM;
    
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  /**
   * STREAM MODE
   * Nutzt die Tatsache, dass Cipheriv/Decipheriv von Transform erben.
   */
  public createStream(mode: 'compress' | 'decompress'): Transform {
    const { type, key } = this.options;
    const iv = randomBytes(12); // Hinweis: IV-Logik für Streams muss noch harmonisiert werden

    return mode === 'compress' 
      ? (createCipheriv(type, key, iv, { authTagLength: 16 } as any) as unknown as Transform)
      : (createDecipheriv(type, key, iv, { authTagLength: 16 } as any) as unknown as Transform);
  }
}