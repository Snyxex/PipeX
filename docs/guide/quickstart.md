# Schnellstart

In diesem Leitfaden erstellen Sie Ihre erste PipeX-Pipeline.

## Grundlegendes Beispiel

Erstellen Sie eine einfache Pipeline, die Daten komprimiert und verschlüsselt:

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin } from 'pipex';

// Engine erstellen
const engine = new DataEngine();

// Plugins zur Pipeline hinzufügen
engine
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ 
    type: 'aes-256-gcm', 
    key: Buffer.from('your-32-byte-secret-key-here1234') 
  }));

// Daten verarbeiten
const inputData = Buffer.from('Hallo Welt - Das ist ein Test!');
const result = await engine.run(inputData);

console.log('Verarbeitete Daten:', result.data);
console.log('Pipeline:', result.pipeline);
console.log('Dauer:', result.metrics.durationMs, 'ms');
```

## Komplettes Beispiel mit Undo

So führen Sie eine Pipeline aus und machen sie rückgängig:

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from 'pipex';

const key = Buffer.from('your-32-byte-secret-key-here1234');
const secret = 'my-secret-key-for-hashing-12';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret }));

// Pipeline ausführen
const originalData = Buffer.from('Geheime Daten hier!');
const result = await engine.run(originalData);

console.log('Verarbeitet in:', result.metrics.durationMs, 'ms');
console.log('Pipeline-Schritte:', result.pipeline);

// Pipeline rückgängig machen
const restored = await engine.undo(result.data);
console.log('Wiederhergestellt:', restored.toString());
```

## Dateiverarbeitung

PipeX kann auch direkt Dateien verarbeiten:

```typescript
import { DataEngine, CompressionPlugin } from 'pipex';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'brotli', level: 9 }));

// Datei verarbeiten
await engine.processFile('input.dat', 'output.dat');

// Datei wiederherstellen
await engine.reverseFile('output.dat', 'restored.dat');
```

## Nächste Schritte

- [Architektur](guide/architecture.md) – Verstehen wie PipeX funktioniert
- [Pipeline-Grundlagen](guide/pipeline-basics.md) – Fortgeschrittene Pipeline-Optionen
- [Plugins](api/plugins.md) – Alle verfügbaren Plugins entdecken