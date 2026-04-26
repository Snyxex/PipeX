import { createHmac } from 'crypto';
import { Transform } from 'stream';
import { BasePlugin } from '../core/plugin';
import type { ProcessorContext} from '../core/types';

interface HashOptions {
  algorithm: 'sha256' | 'sha512';
  secret: string;
}

export class HashingPlugin extends BasePlugin {
  public readonly name = 'hashing-provider';
  public readonly version = '2.2.0';

  constructor(protected options: HashOptions) {
    super(options);
    if (!options.secret || options.secret.length < 16) {
      throw new Error(`[${this.name}] Secret must be at least 16 characters for security.`);
    }
  }

  /**
   * BUFFER MODE: Berechnet den HMAC und gibt ihn als Buffer zurück.
   * Hinweis: Wenn dies mitten in der Pipeline steht, werden die Originaldaten 
   * durch den Hash ersetzt. Meistens ist dies der letzte Schritt.
   */
  public async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const hmac = createHmac(this.options.algorithm, this.options.secret);
    const hash = hmac.update(data).digest();
    
    // Wir speichern den Hash zusätzlich in den Metadaten für das Reporting
    context.metadata.final_hash = hash.toString('hex');
    
    return hash;
  }

  /**
   * STREAM MODE: Ein Pass-through Stream, der den Hash berechnet,
   * während die Daten vorbeifließen, ohne sie zu verändern.
   */
  public createStream(): Transform {
    const hmac = createHmac(this.options.algorithm, this.options.secret);

    return new Transform({
      transform(chunk, encoding, callback) {
        hmac.update(chunk); // Hash berechnen
        callback(null, chunk); // Daten unverändert weitergeben (Transparent)
      },
      flush(callback) {
        const finalHash = hmac.digest('hex');
        // In einem echten System würde man diesen Hash jetzt in eine DB 
        // oder einen Header schreiben.
        console.log(`[Stream Hash] Completed: ${finalHash}`);
        callback();
      }
    });
  }

  /**
   * REVERSE: Hashing kann nicht rückgängig gemacht werden.
   * Bleibt ein Pass-through.
   */
}