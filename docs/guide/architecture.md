# Architektur

PipeX basiert auf einer modularen Plugin-Architektur, die eine flexible und erweiterbare Datenverarbeitung ermöglicht.

## Überblick

```
┌─────────────────────────────────────────────────────────────┐
│                        DataEngine                           │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐    │
│  │Plugin 1 │ → │Plugin 2 │ → │Plugin 3 │ → │Plugin N │    │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Kernkomponenten

### DataEngine

Die `DataEngine` ist die zentrale Klasse, die:
- Plugins verwaltet und verkettet
- Daten durch die Pipeline leitet
- Metriken und Ergebnisse sammelt
- Undo-Funktionalität bereitstellt

### ProcessorPlugin

Jedes Plugin implementiert das `ProcessorPlugin` Interface:

```typescript
interface ProcessorPlugin {
  readonly name: string;
  readonly version: string;
  process(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, context: ProcessorContext): Promise<Buffer> | Buffer;
  createStream?(mode: 'compress' | 'decompress'): any;
}
```

### ProcessorContext

Der Kontext wird bei jedem Plugin-Aufruf übergeben:

```typescript
interface ProcessorContext {
  requestId: string;      // Eindeutige Anfrage-ID
  timestamp: number;      // Zeitstempel
  metadata: Record<string, any>;  // Zusätzliche Metadaten
}
```

## Datenfluss

1. **Input** – Daten werden als Buffer, String oder Datei übergeben
2. **Typ-Erkennung** – DataEngine erkennt den Eingabetyp automatisch
3. **Plugin-Verarbeitung** – Jedes Plugin verarbeitet die Daten sequenziell
4. **Metriken** – Performance-Daten werden für jedes Plugin gesammelt
5. **Output** – Verarbeitete Daten als Buffer zurückgegeben

## Stream-Verarbeitung

Für große Dateien bietet PipeX Stream-Unterstützung:

```typescript
// Datei verarbeiten
await engine.processFile('input.dat', 'output.dat');

// Stream-Verarbeitung
await engine.stream(inputStream, outputStream);
```

## Plugin-Reihenfolge

Die Reihenfolge der Plugins bestimmt die Verarbeitungslogik:

```typescript
// Komprimieren → Verschlüsseln → Hashen
const engine = new DataEngine()
  .use(new CompressionPlugin({ type: 'gzip' }))
  .use(new EncryptionPlugin({ type: 'aes-256-gcm', key }))
  .use(new HashingPlugin({ algorithm: 'sha256', secret }));
```

> **Wichtig:** Die Undo-Funktion führt Plugins in umgekehrter Reihenfolge aus.

## Erweiterbarkeit

Sie können eigene Plugins erstellen, indem Sie das `BasePlugin` erweitern oder das `ProcessorPlugin` Interface implementieren.

Siehe auch: [Eigene Plugins entwickeln](guide/custom-plugins.md)