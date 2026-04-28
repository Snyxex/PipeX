# Eigene Plugins entwickeln

PipeX bietet ein flexibles Plugin-System, das Sie erweitern können, um eigene Datenverarbeitungs-Plugins zu erstellen.

## Plugin erstellen

### Option 1: BasePlugin erweitern

Der einfachste Weg, ein eigenes Plugin zu erstellen:

```typescript
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

interface MyPluginOptions {
  mode: 'uppercase' | 'lowercase';
}

export class MyPlugin extends BasePlugin {
  readonly name = 'my-custom-plugin';
  readonly version = '1.0.0';

  constructor(protected override options: MyPluginOptions) {
    super(options);
  }

  async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    const text = data.toString('utf-8');
    const transformed = this.options.mode === 'uppercase' 
      ? text.toUpperCase() 
      : text.toLowerCase();
    return Buffer.from(transformed, 'utf-8');
  }

  // Optional: Reverse-Methode für Undo-Funktion
  async reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    // Da Transformation nicht umkehrbar ist, Daten unverändert zurückgeben
    return data;
  }
}
```

### Option 2: ProcessorPlugin Interface implementieren

Für vollständige Kontrolle:

```typescript
import type { ProcessorPlugin, ProcessorContext } from 'pipex';

export class RawPlugin implements ProcessorPlugin {
  readonly name = 'raw-processor';
  readonly version = '1.0.0';

  async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    // Ihre Verarbeitungslogik hier
    context.metadata['processed'] = true;
    return data;
  }
}
```

## Plugin mit Stream-Unterstützung

Für bessere Performance bei großen Datenmengen:

```typescript
import { Transform } from 'node:stream';
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';

export class StreamPlugin extends BasePlugin {
  readonly name = 'stream-processor';
  readonly version = '1.0.0';

  createStream(mode: 'compress' | 'decompress'): Transform {
    return new Transform({
      transform(chunk, encoding, callback) {
        // Stream-Verarbeitung
        const processed = this.processSync(chunk);
        callback(null, processed);
      }
    });
  }

  private processSync(chunk: Buffer): Buffer {
    // Synchronisierte Verarbeitung
    return chunk;
  }

  async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    return this.processSync(data);
  }
}
```

## Plugin registrieren

```typescript
import { DataEngine } from 'pipex';
import { MyPlugin } from './my-plugin';

const engine = new DataEngine()
  .use(new MyPlugin({ mode: 'uppercase' }));
```

## Best Practices

### 1. Versionsnummerierung

Verwenden Sie semantische Versionierung:

```typescript
readonly name = 'my-plugin';
readonly version = '1.0.0'; // Major.Minor.Patch
```

### 2. Fehlerbehandlung

Werfen Sie aussagekräftige Fehler:

```typescript
async process(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
  if (data.length === 0) {
    throw new Error('[MyPlugin] Input data is empty');
  }
  // Verarbeitung
}
```

### 3. Kontext-Metadaten

Nutzen Sie den Kontext für Metriken:

```typescript
async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
  context.metadata['inputSize'] = data.length;
  // Verarbeitung
  context.metadata['outputSize'] = result.length;
  return result;
}
```

### 4. Optionen validieren

```typescript
constructor(protected override options: MyOptions) {
  super(options);
  if (!options.apiKey || options.apiKey.length < 16) {
    throw new Error('[MyPlugin] apiKey must be at least 16 characters');
  }
}
```

## Vollständiges Beispiel

```typescript
import { BasePlugin } from 'pipex';
import type { ProcessorContext } from 'pipex';
import { createHash } from 'node:crypto';

interface HashPluginOptions {
  algorithm: 'sha256' | 'sha512';
  includeHash: boolean;
}

export class CustomHashPlugin extends BasePlugin {
  readonly name = 'custom-hash';
  readonly version = '1.0.0';

  constructor(protected override options: HashPluginOptions) {
    super(options);
  }

  async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    if (this.options.includeHash) {
      const hash = createHash(this.options.algorithm)
        .update(data)
        .digest();
      return Buffer.concat([data, hash]);
    }
    return data;
  }

  async reverse(data: Buffer, _context: ProcessorContext): Promise<Buffer> {
    // Hash entfernen (abhängig vom Algorithmus)
    const hashLength = this.options.algorithm === 'sha256' ? 32 : 64;
    return data.subarray(0, -hashLength);
  }
}
```

## Nächste Schritte

- [API-Referenz](api/types.md) – TypeScript-Typdefinitionen
- [Beispiele](examples/custom-plugins.md) – Weitere Plugin-Beispiele