# DataEngine

Die `DataEngine` Klasse ist die zentrale Komponente von PipeX. Sie verwaltet Plugins, führt Pipelines aus und sammelt Metriken.

## Import

```typescript
import { DataEngine } from 'pipex';
```

## Konstruktor

```typescript
const engine = new DataEngine();
```

## Methoden

### use()

Fügt ein Plugin zur Pipeline hinzu.

```typescript
use(plugin: ProcessorPlugin): this
```

**Parameter:**
- `plugin` – Eine Instanz eines `ProcessorPlugin`

**Rückgabe:** Die Engine-Instanz (für Method Chaining)

**Beispiel:**

```typescript
const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }));
```

---

### run()

Führt die Pipeline mit den angegebenen Daten aus.

```typescript
run(input: any): Promise<EngineResult>
```

**Parameter:**
- `input` – Eingabedaten (Buffer, String, ArrayBuffer oder Dateipfad)

**Rückgabe:** `Promise<EngineResult>`

**EngineResult:**

```typescript
interface EngineResult {
  data: Buffer;           // Verarbeitete Daten
  pipeline: string[];     // Verwendete Plugins mit Versionen
  metrics: {
    durationMs: number;           // Gesamtdauer in Millisekunden
    steps: Record<string, number>; // Dauer pro Plugin
  };
}
```

**Beispiel:**

```typescript
const result = await engine.run(Buffer.from('Hallo Welt!'));

console.log(result.data);
console.log(result.pipeline);   // ['compression-provider@2.0.0', ...]
console.log(result.metrics);    // { durationMs: 150, steps: {...} }
```

---

### undo()

Macht die Pipeline rückgängig und stellt die Originaldaten wieder her.

```typescript
undo<T = any>(input: Buffer, forceType?: string): Promise<T>
```

**Parameter:**
- `input` – Die verarbeiteten Daten als Buffer
- `forceType` – Optionaler erzwungener Ausgabetyp (`'buffer'`, `'string'`, `'arrayBuffer'`)

**Rückgabe:** `Promise<T>` – Die wiederhergestellten Daten

**Beispiel:**

```typescript
const result = await engine.run(originalData);

// Pipeline rückgängig machen
const restored = await engine.undo(result.data);
console.log(restored.toString()); // Originaldaten
```

---

### stream()

Verarbeitet Daten als Stream.

```typescript
stream(input: Readable, output: Writable): Promise<void>
```

**Parameter:**
- `input` – Ein Node.js Readable Stream
- `output` – Ein Node.js Writable Stream

**Rückgabe:** `Promise<void>`

**Beispiel:**

```typescript
import { createReadStream, createWriteStream } from 'fs';

const input = createReadStream('input.dat');
const output = createWriteStream('output.dat');

await engine.stream(input, output);
```

---

### processFile()

Verarbeitet eine Datei durch die Pipeline.

```typescript
processFile(inputPath: string, outputPath: string): Promise<void>
```

**Parameter:**
- `inputPath` – Pfad zur Eingabedatei
- `outputPath` – Pfad zur Ausgabedatei

**Rückgabe:** `Promise<void>`

**Beispiel:**

```typescript
await engine.processFile('data/input.dat', 'data/output.dat');
```

---

### reverseFile()

Stellt eine verarbeitete Datei wieder her.

```typescript
reverseFile(inputPath: string, outputPath: string): Promise<void>
```

**Parameter:**
- `inputPath` – Pfad zur verarbeiteten Datei
- `outputPath` – Pfad für die wiederhergestellte Datei

**Rückgabe:** `Promise<void>`

**Beispiel:**

```typescript
await engine.reverseFile('data/output.dat', 'data/restored.dat');
```

---

## Vollständiges Beispiel

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from 'pipex';

const key = Buffer.from('your-32-byte-secret-key-here1234');
const secret = 'my-secret-key-for-hashing-12';

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret }));

// Daten verarbeiten
const input = Buffer.from('Testdaten für die Verarbeitung');
const result = await engine.run(input);

console.log('Verarbeitet in:', result.metrics.durationMs, 'ms');
console.log('Pipeline:', result.pipeline);

// Wiederherstellen
const restored = await engine.undo(result.data);
```

## Siehe auch

- [Pipeline-Grundlagen](guide/pipeline-basics.md)
- [Plugins](api/plugins.md)
- [Typen](api/types.md)