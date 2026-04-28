# PipeX

> Ein leichtgewichtiges, modulares Daten-Transformations-Framework. Verketten Sie mühelos Kompression, Verschlüsselung und Hashing durch eine einheitliche Stream-basierte Architektur.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

## Features

- **Plugin-Architektur** – Modular erweiterbar durch eigene Plugins
- **Stream-basiert** – Effiziente Verarbeitung großer Datenmengen ohne Speicherprobleme
- **Integrierte Plugins** – Kompression, Verschlüsselung, Hashing, Performance-Messung
- **Worker-Pool** – Parallele Verarbeitung für maximale Performance
- **Undo-Funktion** – Pipeline rückgängig machen mit `undo()`
- **Typ-sicher** – Vollständige TypeScript-Unterstützung


## Schnellstart

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from 'pipex';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key: Buffer.from(process.env.KEY!) }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret: 'my-secret-key' }));

// Daten verarbeiten
const result = await engine.run(inputData);

// Pipeline rückgängig machen
const original = await engine.undo(result.data);
```

## Plugins

| Plugin | Beschreibung | Optionen |
|--------|--------------|----------|
| `CompressionPlugin` | Gzip oder Brotli Kompression | `type: 'gzip' \| 'brotli'`, `level: 1-9` |
| `EncryptionPlugin` | AES-256-GCM oder ChaCha20-Poly1305 | `type: 'aes-256-gcm' \| 'chacha20-poly1305'`, `key: Buffer` |
| `HashingPlugin` | SHA256 oder SHA512 HMAC | `algorithm: 'sha256' \| 'sha512'`, `secret: string` |
| `BenchmarkPlugin` | Performance-Messung | – |
| `WorkerPoolPlugin` | Parallele Worker-Verarbeitung | `workers: number` |

## API

### DataEngine

```typescript
class DataEngine {
  use(plugin: ProcessorPlugin): this;  // Plugin zur Pipeline hinzufügen
  run(input: any): Promise<EngineResult>;  // Pipeline ausführen
  undo<T>(input: Buffer, forceType?: string): Promise<T>;  // Pipeline rückgängig
}
```

### EngineResult

```typescript
interface EngineResult {
  data: Buffer;                    // Verarbeitete Daten
  pipeline: string[];              // Verwendete Plugins
  metrics: {
    durationMs: number;           // Gesamtdauer in ms
    steps: Record<string, number>; // Dauer pro Plugin
  };
}
```

## Beispiel: Datei verarbeiten

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin } from 'pipex';
import { readFileSync, writeFileSync } from 'fs';

const input = readFileSync('large-file.dat');
const key = Buffer.from('your-32-byte-secret-key-here!');

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'brotli', level: 9 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));

const result = await engine.run(input);

writeFileSync('output.dat', result.data);
console.log(`Verarbeitet in ${result.metrics.durationMs}ms`);
```

## Entwicklung

```bash
# Tests ausführen
npm run test:core
npm run test:plugin
npm run test:compression

# Build erstellen
npm run build
```

## Anforderungen

- Node.js ≥ 20.0.0

## Lizenz

MIT – [LICENSE](LICENSE)

---

Erstellt von [Snyxex](https://github.com/Snyxex)