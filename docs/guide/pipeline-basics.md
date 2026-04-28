# Pipeline-Grundlagen

Die Pipeline ist das Herzstück von PipeX. In diesem Leitfaden lernen Sie fortgeschrittene Pipeline-Optionen.

## Pipeline erstellen

### Grundlegende Pipeline

```typescript
const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));
```

### Verkettung mit fluent API

Die `use()` Methode gibt die Engine-Instanz zurück, sodass Sie Plugins verketten können:

```typescript
const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret }))
  .use(new BenchmarkPlugin());
```

## Pipeline ausführen

### run() – Daten verarbeiten

```typescript
const result = await engine.run(inputData);

// Ergebnis enthält:
result.data;        // Verarbeitete Daten als Buffer
result.pipeline;    // Array der verwendeten Plugins
result.metrics;     // Performance-Metriken
```

### undo() – Pipeline rückgängig machen

```typescript
// Nach run() kann die Pipeline rückgängig gemacht werden
const original = await engine.undo(result.data);

// Mit erzwungenem Ausgabetyp
const restored = await engine.undo(result.data, 'string');
```

## Datei-Pipeline

### processFile() – Datei verarbeiten

```typescript
await engine.processFile('input.dat', 'output.dat');
```

### reverseFile() – Datei wiederherstellen

```typescript
await engine.reverseFile('output.dat', 'restored.dat');
```

## Stream-Pipeline

### stream() – Stream verarbeiten

```typescript
import { createReadStream, createWriteStream } from 'fs';

const input = createReadStream('input.dat');
const output = createWriteStream('output.dat');

await engine.stream(input, output);
```

## Metriken

Jede Pipeline-Ausführung sammelt Metriken:

```typescript
const result = await engine.run(data);

console.log(result.metrics);
// Ausgabe:
// {
//   durationMs: 150,
//   steps: {
//     'compression-provider': 45,
//     'encryption-provider': 80,
//     'hashing-provider': 25
//   }
// }
```

## Pipeline-Optionen

### Dynamische Plugins

```typescript
const useEncryption = process.env.NODE_ENV === 'production';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }));

if (useEncryption) {
  engine.use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));
}
```

### Plugin-Versionierung

Jedes Plugin führt seine Version im Pipeline-Array:

```typescript
const result = await engine.run(data);
console.log(result.pipeline);
// ['compression-provider@2.0.0', 'encryption-provider@2.1.2']
```

## Fehlerbehandlung

```typescript
try {
  const result = await engine.run(data);
} catch (error) {
  if (error.message.includes('Plugin')) {
    console.log('Plugin-Fehler:', error.message);
  } else {
    throw error;
  }
}
```

## Nächste Schritte

- [Eigene Plugins entwickeln](guide/custom-plugins.md) – Erstellen Sie eigene Plugins
- [API-Referenz](api/data-engine.md) – Vollständige API-Dokumentation