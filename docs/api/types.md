# Typen

PipeX bietet vollständige TypeScript-Typdefinitionen. Hier sind alle wichtigen Typen dokumentiert.

## ProcessorContext

Der Kontext, der bei jedem Plugin-Aufruf übergeben wird.

```typescript
interface ProcessorContext {
  requestId: string;
  timestamp: number;
  metadata: Record<string, any>;
}
```

**Eigenschaften:**
- `requestId` – Eindeutige ID für diese Anfrage
- `timestamp` – Zeitstempel des Aufrufs (Unix Timestamp in ms)
- `metadata` – Zusätzliche Metadaten für Plugin-Kommunikation

**Beispiel:**

```typescript
async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
  console.log('Request ID:', context.requestId);
  console.log('Timestamp:', new Date(context.timestamp));
  
  // Metadaten setzen
  context.metadata['processed'] = true;
  context.metadata['inputSize'] = data.length;
  
  return data;
}
```

---

## ProcessorPlugin

Das Interface, das jedes Plugin implementieren muss.

```typescript
interface ProcessorPlugin {
  readonly name: string;
  readonly version: string;
  process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): any;
}
```

**Eigenschaften:**
- `name` – Eindeutiger Name des Plugins
- `version` – Versionsstring (semantische Versionierung)
- `process` – Verarbeitungsfunktion (erforderlich)
- `reverse` – Optionale Funktion für Undo-Funktionalität
- `createStream` – Optionale Funktion für Stream-Verarbeitung

**Beispiel:**

```typescript
const myPlugin: ProcessorPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  async process(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    // Verarbeitungslogik
    return data;
  },
  
  async reverse(data: Buffer, context: ProcessorContext): Promise<Buffer> {
    // Rückgängig-Logik
    return data;
  }
};
```

---

## EngineResult

Das Ergebnis einer Pipeline-Ausführung.

```typescript
interface EngineResult {
  data: Buffer;
  pipeline: string[];
  metrics: {
    durationMs: number;
    steps: Record<string, number>;
  };
}
```

**Eigenschaften:**
- `data` – Die verarbeiteten Daten als Buffer
- `pipeline` – Array der verwendeten Plugins mit Versionen
- `metrics.durationMs` – Gesamtdauer der Pipeline in Millisekunden
- `metrics.steps` – Dauer für jeden einzelnen Plugin-Schritt

**Beispiel:**

```typescript
const result = await engine.run(data);

console.log(result.data);           // <Buffer 01 02 03 ...>
console.log(result.pipeline);       // ['compression@2.0.0', 'encryption@2.1.2']
console.log(result.metrics.durationMs);  // 150
console.log(result.metrics.steps);       // { 'compression@2.0.0': 45, 'encryption@2.1.2': 105 }
```

---

## CompressionOptions

Optionen für das CompressionPlugin.

```typescript
interface CompressionOptions {
  type: 'gzip' | 'brotli' | 'none';
  level?: number;
}
```

- `type` – Komprimierungsalgorithmus
- `level` – Komprimierungsstufe (1-9, Standard: 6)

---

## EncryptionOptions

Optionen für das EncryptionPlugin.

```typescript
interface EncryptionOptions {
  type: 'aes-256-gcm' | 'chacha20-poly1305';
  key: Buffer;
}
```

- `type` – Verschlüsselungsalgorithmus
- `key` – 32-Byte Schlüssel

---

## HashOptions

Optionen für das HashingPlugin.

```typescript
interface HashOptions {
  algorithm: 'sha256' | 'sha512';
  secret: string;
}
```

- `algorithm` – Hash-Algorithmus
- `secret` – Geheimer Schlüssel (mindestens 16 Zeichen)

---

## WorkerOptions

Optionen für das WorkerPoolPlugin.

```typescript
interface WorkerOptions {
  maxThreads?: number;
}
```

- `maxThreads` – Maximale Anzahl von Worker-Threads

---

## Unterstützte Eingabetypen

PipeX unterstützt verschiedene Eingabetypen:

```typescript
type InputType = Buffer | string | ArrayBuffer;
```

Die Engine erkennt den Typ automatisch und konvertiert ihn entsprechend.

---

## Unterstützte Ausgabetypen

Für die `undo()` Methode:

```typescript
type OutputType = 'buffer' | 'string' | 'arrayBuffer';
```

**Beispiel:**

```typescript
// Als String wiederherstellen
const restored = await engine.undo(result.data, 'string');

// Als ArrayBuffer wiederherstellen
const restored = await engine.undo(result.data, 'arrayBuffer');
```

---

## Siehe auch

- [DataEngine](api/data-engine.md)
- [Plugins](api/plugins.md)
- [Eigene Plugins entwickeln](guide/custom-plugins.md)