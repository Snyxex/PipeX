# Plugins

PipeX wird mit mehreren integrierten Plugins geliefert, die verschiedene Datenverarbeitungsfunktionen bieten.

## Übersicht

| Plugin | Beschreibung | Version |
|--------|--------------|---------|
| `CompressionPlugin` | Datenkompression (gzip, brotli) | 2.0.0 |
| `EncryptionPlugin` | Datenverschlüsselung (AES, ChaCha20) | 2.1.2 |
| `HashingPlugin` | Kryptografisches Hashing (SHA256, SHA512) | 2.2.0 |
| `BenchmarkPlugin` | Performance-Messung | 1.0.0 |
| `WorkerPoolPlugin` | Parallele Worker-Verarbeitung | 1.3.0 |

---

## CompressionPlugin

Komprimiert Daten mit gzip oder brotli.

### Import

```typescript
import { CompressionPlugin } from 'pipex';
```

### Konstruktor

```typescript
new CompressionPlugin(options: CompressionOptions)
```

### Optionen

```typescript
interface CompressionOptions {
  type: 'gzip' | 'brotli' | 'none';
  level?: number; // 1-9 (Standard: 6)
}
```

### Beispiel

```typescript
const plugin = new CompressionPlugin({ 
  type: 'gzip', 
  level: 6 
});

const engine = new DataEngine().use(plugin);
const result = await engine.run(data);
```

---

## EncryptionPlugin

Verschlüsselt Daten mit AES-256-GCM oder ChaCha20-Poly1305.

### Import

```typescript
import { EncryptionPlugin } from 'pipex';
```

### Konstruktor

```typescript
new EncryptionPlugin(options: EncryptionOptions)
```

### Optionen

```typescript
interface EncryptionOptions {
  type: 'aes-256-gcm' | 'chacha20-poly1305';
  key: Buffer; // 32-Byte Schlüssel
}
```

### Beispiel

```typescript
const key = Buffer.from('your-32-byte-secret-key-here1234');

const plugin = new EncryptionPlugin({ 
  type: 'aes-256-gcm', 
  key 
});

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }))
  .use(plugin);

const result = await engine.run(data);
const restored = await engine.undo(result.data);
```

---

## HashingPlugin

Erstellt kryptografische HMAC-Hashes.

### Import

```typescript
import { HashingPlugin } from 'pipex';
```

### Konstruktor

```typescript
new HashingPlugin(options: HashOptions)
```

### Optionen

```typescript
interface HashOptions {
  algorithm: 'sha256' | 'sha512';
  secret: string; // Mindestens 16 Zeichen
}
```

### Beispiel

```typescript
const plugin = new HashingPlugin({ 
  algorithm: 'sha256', 
  secret: 'my-secret-key-minimum-16-chars' 
});

const engine = new DataEngine().use(plugin);
const result = await engine.run(data);
```

---

## BenchmarkPlugin

Misst die Performance und sammelt Metriken.

### Import

```typescript
import { BenchmarkPlugin } from 'pipex';
```

### Konstruktor

```typescript
new BenchmarkPlugin()
```

### Metadaten

Das Plugin fügt folgende Metadaten zum Kontext hinzu:

- `inputBytes` – Größe der Eingabedaten in Bytes
- `inputKB` – Größe in Kilobytes (gerundet)

### Beispiel

```typescript
const plugin = new BenchmarkPlugin();

const engine = new DataEngine()
  .use(plugin)
  .use(new CompressionPlugin({ type: 'gzip' }));

const result = await engine.run(data);
// Metriken sind in result.metrics verfügbar
```

---

## WorkerPoolPlugin

Ermöglicht parallele Verarbeitung mit Worker-Threads.

### Import

```typescript
import { WorkerPoolPlugin } from 'pipex';
```

### Konstruktor

```typescript
new WorkerPoolPlugin(options?: WorkerOptions)
```

### Optionen

```typescript
interface WorkerOptions {
  maxThreads?: number; // Standard: CPU-Kerne - 2
}
```

### Beispiel

```typescript
const plugin = new WorkerPoolPlugin({ 
  maxThreads: 4 
});

const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }))
  .use(plugin);

// Automatische Nutzung von Worker-Threads
const result = await engine.run(data);
```

### Hinweis

Der `WorkerPoolPlugin` nutzt automatisch alle verfügbaren CPU-Kerne abzüglich 2 für Hintergrundprozesse.

---

## Plugins kombinieren

Mehrere Plugins können in einer Pipeline kombiniert werden:

```typescript
const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip', level: 6 }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret }))
  .use(new BenchmarkPlugin());

const result = await engine.run(inputData);
```

Die Reihenfolge der Plugins bestimmt die Verarbeitungsreihenfolge. Für Undo-Funktionalität müssen alle Plugins eine `reverse()` Methode implementieren.

## Siehe auch

- [Eigene Plugins entwickeln](guide/custom-plugins.md)
- [Typen](api/types.md)