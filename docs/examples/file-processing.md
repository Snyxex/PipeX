# Dateiverarbeitung

PipeX kann effizient große Dateien verarbeiten, ohne den gesamten Inhalt in den Speicher zu laden.

## processFile()

Die einfachste Methode, eine Datei zu verarbeiten:

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin } from 'pipex';

const key = Buffer.from('your-32-byte-secret-key-here1234');

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'brotli', level: 9 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));

// Datei verarbeiten
await engine.processFile('data/grosses-video.mp4', 'data/verschluesselt.mp4');
```

## reverseFile()

Die verarbeitete Datei wiederherstellen:

```typescript
// Datei wiederherstellen
await engine.reverseFile('data/verschluesselt.mp4', 'data/wiederhergestellt.mp4');
```

## Fortgeschrittene Dateiverarbeitung

### Mit Fortschrittsanzeige

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { DataEngine, CompressionPlugin } from 'pipex';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }));

const inputPath = 'data/large-file.bin';
const outputPath = 'data/compressed-file.bin';

// Stream-basierte Verarbeitung mit Fortschrittsanzeige
const inputSize = (await import('fs')).statSync(inputPath).size;
let processed = 0;

const input = createReadStream(inputPath, { highWaterMark: 1024 * 1024 });
const output = createWriteStream(outputPath);

input.on('data', (chunk) => {
  processed += chunk.length;
  const percent = Math.round((processed / inputSize) * 100);
  console.log(`Fortschritt: ${percent}%`);
});

await engine.stream(input, output);
console.log('Verarbeitung abgeschlossen!');
```

### Mit Benchmark

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin, BenchmarkPlugin } from 'pipex';

const key = Buffer.from('your-32-byte-secret-key-here1234');

const engine = new DataEngine()
  .use(new BenchmarkPlugin())
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));

const inputFile = 'data/input.bin';
const outputFile = 'data/output.bin';

console.log('Starte Dateiverarbeitung...');
const startTime = Date.now();

await engine.processFile(inputFile, outputFile);

const duration = Date.now() - startTime;
console.log(`Abgeschlossen in ${duration}ms`);

// Dateigrößen vergleichen
import { statSync } from 'fs';
const originalSize = statSync(inputFile).size;
const processedSize = statSync(outputFile).size;

console.log(`Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Verarbeitet: ${(processedSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Verkleinerung: ${Math.round((1 - processedSize / originalSize) * 100)}%`);
```

## Mehrere Dateien verarbeiten

```typescript
import { DataEngine, CompressionPlugin } from 'pipex';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }));

const inputDir = 'data/input';
const outputDir = 'data/output';

const files = readdirSync(inputDir);

for (const file of files) {
  const inputPath = join(inputDir, file);
  const outputPath = join(outputDir, file + '.gz');
  
  if (statSync(inputPath).isFile()) {
    console.log(`Verarbeite: ${file}`);
    await engine.processFile(inputPath, outputPath);
  }
}

console.log('Alle Dateien verarbeitet!');
```

## Hinweise

- **Speichereffizienz**: Die Stream-basierte Verarbeitung lädt nicht die gesamte Datei in den Speicher
- **Große Dateien**: Ideal für Dateien > 100 MB
- **Fehlerbehandlung**: Bei Fehlern wird die Ausgabedatei nicht erstellt

## Siehe auch

- [Stream-Verarbeitung](examples/stream-processing.md)
- [DataEngine API](api/data-engine.md)