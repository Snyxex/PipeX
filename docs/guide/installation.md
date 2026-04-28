# Installation

PipeX kann einfach über npm installiert werden.

## Voraussetzungen

- Node.js ≥ 20.0.0
- npm, yarn oder pnpm

## Installation

```bash
npm install pipex
```

Oder mit yarn:

```bash
yarn add pipex
```

Oder mit pnpm:

```bash
pnpm add pipex
```

## TypeScript-Konfiguration

PipeX ist in TypeScript geschrieben und bietet vollständige Typ-Unterstützung. Stellen Sie sicher, dass Ihr `tsconfig.json` entsprechend konfiguriert ist:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true
  }
}
```

## Import

```typescript
import { DataEngine, CompressionPlugin, EncryptionPlugin, HashingPlugin } from 'pipex';
```

## Nächste Schritte

- [Schnellstart](guide/quickstart.md) – Erstellen Sie Ihre erste Pipeline
- [API-Referenz](api/data-engine.md) – Entdecken Sie die verfügbaren Klassen und Methoden