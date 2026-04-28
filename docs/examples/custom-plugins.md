# Benutzerdefinierte Plugins

Hier finden Sie Beispiele für die Erstellung eigener PipeX-Plugins.

## Einfaches Text-Plugin

Ein Plugin, das Text transformiert:

```typescript
// plugins/text-transform.ts
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

interface TextTransformOptions {
  mode: 'uppercase' | 'lowercase' | 'titlecase';
}

export class TextTransformPlugin extends BasePlugin {
  readonly name = 'text-transform';
  readonly version = '1.0.0';

  constructor(protected override options: TextTransformOptions) {
    super(options);
  }

  async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    const text = data.toString('utf-8');
    let transformed: string;

    switch (this.options.mode) {
      case 'uppercase':
        transformed = text.toUpperCase();
        break;
      case 'lowercase':
        transformed = text.toLowerCase();
        break;
      case 'titlecase':
        transformed = text.replace(/\w\S*/g, (txt) => 
          txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
        break;
      default:
        transformed = text;
    }

    return Buffer.from(transformed, 'utf-8');
  }
}
```

**Verwendung:**

```typescript
import { DataEngine } from 'pipex';
import { TextTransformPlugin } from './plugins/text-transform';

const engine = new DataEngine()
  .use(new TextTransformPlugin({ mode: 'titlecase' }));

const result = await engine.run(Buffer.from('hello world'));
console.log(result.data.toString()); // "Hello World"
```

## Base64-Encoding-Plugin

```typescript
// plugins/base64.ts
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

interface Base64Options {
  encode: boolean; // true = encode, false = decode
}

export class Base64Plugin extends BasePlugin {
  readonly name = 'base64-encoder';
  readonly version = '1.0.0';

  constructor(protected override options: Base64Options) {
    super(options);
  }

  async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    if (this.options.encode) {
      return Buffer.from(data.toString('base64'), 'utf-8');
    } else {
      return Buffer.from(data.toString('utf-8'), 'base64');
    }
  }

  async reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    // Reverse ist das Gegenteil
    return Buffer.from(data.toString('utf-8'), 'base64');
  }
}
```

## JSON-Verarbeitungs-Plugin

```typescript
// plugins/json-processor.ts
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

interface JsonProcessorOptions {
  format: 'compact' | 'pretty';
}

export class JsonProcessorPlugin extends BasePlugin {
  readonly name = 'json-processor';
  readonly version = '1.0.0';

  constructor(protected override options: JsonProcessorOptions) {
    super(options);
  }

  async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    const text = data.toString('utf-8');
    const obj = JSON.parse(text);
    
    let output: string;
    if (this.options.format === 'pretty') {
      output = JSON.stringify(obj, null, 2);
    } else {
      output = JSON.stringify(obj);
    }

    return Buffer.from(output, 'utf-8');
  }
}
```

## Stream-fähiges Plugin

Für bessere Performance bei großen Datenmengen:

```typescript
// plugins/line-count.ts
import { Transform } from 'node:stream';
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

export class LineCountPlugin extends BasePlugin {
  readonly name = 'line-counter';
  readonly version = '1.0.0';

  private lineCount = 0;

  createStream(mode: 'compress' | 'decompress'): Transform {
    return new Transform({
      transform(chunk, encoding, callback) {
        // Zeilen zählen
        const lines = chunk.toString().split('\n').length - 1;
        this.lineCount += lines;
        callback(null, chunk);
      }
    });
  }

  async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const lines = data.toString('utf-8').split('\n').length - 1;
    this.lineCount += lines;
    
    // Metadaten setzen
    context.metadata['lineCount'] = this.lineCount;
    
    return data;
  }
}
```

## Kryptografisches Plugin

Ein Plugin für benutzerdefinierte Hashing-Funktionen:

```typescript
// plugins/md5-hash.ts
import { createHash } from 'node:crypto';
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

export class MD5HashPlugin extends BasePlugin {
  readonly name = 'md5-hash';
  readonly version = '1.0.0';

  async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    const hash = createHash('md5').update(data).digest();
    
    // Hash als Metadaten speichern
    context.metadata['hash'] = hash.toString('hex');
    
    return Buffer.concat([data, hash]);
  }

  async reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    // MD5-Hash (16 Bytes) entfernen
    return data.subarray(0, -16);
  }
}
```

## Plugin mit Konfiguration

```typescript
// plugins/validator.ts
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

interface ValidatorOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export class ValidatorPlugin extends BasePlugin {
  readonly name = 'validator';
  readonly version = '1.0.0';

  constructor(protected override options: ValidatorOptions) {
    super(options);
    
    // Optionen validieren
    if (options.minLength !== undefined && options.minLength < 0) {
      throw new Error('[Validator] minLength must be positive');
    }
    if (options.maxLength !== undefined && options.maxLength < 0) {
      throw new Error('[Validator] maxLength must be positive');
    }
  }

  async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    const text = data.toString('utf-8');
    
    // Längenprüfung
    if (this.options.minLength !== undefined && text.length < this.options.minLength) {
      throw new Error(`[Validator] Data too short: ${text.length} < ${this.options.minLength}`);
    }
    if (this.options.maxLength !== undefined && text.length > this.options.maxLength) {
      throw new Error(`[Validator] Data too long: ${text.length} > ${this.options.maxLength}`);
    }
    
    // Musterprüfung
    if (this.options.pattern !== undefined && !this.options.pattern.test(text)) {
      throw new Error('[Validator] Pattern mismatch');
    }
    
    return data;
  }
}
```

## Plugins kombinieren

```typescript
import { DataEngine } from 'pipex';
import { TextTransformPlugin } from './plugins/text-transform';
import { Base64Plugin } from './plugins/base64';
import { ValidatorPlugin } from './plugins/validator';

const engine = new DataEngine()
  .use(new ValidatorPlugin({ minLength: 5, maxLength: 100 }))
  .use(new TextTransformPlugin({ mode: 'uppercase' }))
  .use(new Base64Plugin({ encode: true }));

const result = await engine.run(Buffer.from('hello pipex'));
```

## Siehe auch

- [Eigene Plugins entwickeln](guide/custom-plugins.md)
- [API-Referenz: Plugins](api/plugins.md)