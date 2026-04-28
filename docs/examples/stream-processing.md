# Stream-Verarbeitung

PipeX unterstützt Node.js Streams für effiziente Verarbeitung großer Datenmengen.

## Grundlagen

Streams ermöglichen die Verarbeitung von Daten, ohne sie vollständig in den Speicher zu laden:

```
[Readable Stream] → [Pipeline] → [Writable Stream]
```

## stream() Methode

```typescript
stream(input: Readable, output: Writable): Promise<void>
```

## Einfaches Beispiel

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { DataEngine, CompressionPlugin, EncryptionPlugin } from 'pipex';

const key = Buffer.from('your-32-byte-secret-key-here1234');

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));

const input = createReadStream('input.dat');
const output = createWriteStream('output.dat');

await engine.stream(input, output);
console.log('Stream-Verarbeitung abgeschlossen!');
```

## Mit Transform-Streams

Für benutzerdefinierte Stream-Verarbeitung:

```typescript
import { Transform } from 'node:stream';
import { DataEngine, CompressionPlugin } from 'pipex';

// Eigenen Transform-Stream erstellen
class UpperCaseTransform extends Transform {
  constructor() {
    super();
  }

  _transform(chunk, encoding, callback) {
    const upperCased = chunk.toString().toUpperCase();
    this.push(Buffer.from(upperCased));
    callback();
  }
}

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }));

// Manueller Stream mit eigenem Transform
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'fs';

const input = createReadStream('input.txt');
const output = createWriteStream('output.txt');
const transform = new UpperCaseTransform();

await pipeline(
  input,
  transform,
  ...engine.plugins.map(p => p.createStream?.('compress') || new Transform()),
  output
);
```

## HTTP-Stream-Verarbeitung

PipeX kann mit HTTP-Streams verwendet werden:

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { DataEngine, CompressionPlugin } from 'pipex';
import http from 'http';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }));

const server = http.createServer(async (req, res) => {
  if (req.url === '/upload' && req.method === 'POST') {
    const fileStream = createWriteStream('uploaded.dat');
    
    await engine.stream(req, fileStream);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }
});

server.listen(3000, () => {
  console.log('Server läuft auf Port 3000');
});
```

## Pipeline mit mehreren Streams

```typescript
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from 'pipex';

const key = Buffer.from('your-32-byte-secret-key-here1234');
const secret = 'my-secret-key-for-hashing-12';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret }));

// Streams für jeden Schritt erstellen
const streams = engine.plugins
  .map(plugin => plugin.createStream?.('compress'))
  .filter(Boolean);

await pipeline(
  createReadStream('input.dat'),
  ...streams,
  createWriteStream('output.dat')
);
```

## Backpressure-Handling

PipeX handhabt Backpressure automatisch:

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { DataEngine, CompressionPlugin } from 'pipex';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 9 }));

// Automatisches Backpressure-Handling
const input = createReadStream('huge-file.bin', { 
  highWaterMark: 64 * 1024  // 64KB Chunks
});
const output = createWriteStream('compressed.bin', { 
  highWaterMark: 64 * 1024 
});

await engine.stream(input, output);
```

## Fortschrittsanzeige

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { statSync } from 'fs';
import { DataEngine, CompressionPlugin } from 'pipex';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }));

const inputPath = 'large-file.dat';
const outputPath = 'compressed.dat';

const inputSize = statSync(inputPath).size;
let bytesProcessed = 0;

const input = createReadStream(inputPath);
const output = createWriteStream(outputPath);

// Fortschritt verfolgen
input.on('data', (chunk) => {
  bytesProcessed += chunk.length;
  const percent = Math.round((bytesProcessed / inputSize) * 100);
  process.stdout.write(`\rFortschritt: ${percent}%`);
});

await engine.stream(input, output);

console.log('\nVerarbeitung abgeschlossen!');
```

## Siehe auch

- [Dateiverarbeitung](examples/file-processing.md)
- [DataEngine API](api/data-engine.md)
- [Node.js Streams Dokumentation](https://nodejs.org/api/stream.html)