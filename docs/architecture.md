# PipeX Architecture Guide

This document describes the internal design and philosophy of the PipeX Data Engine.

## 🏗️ The Three-Tier Design

PipeX is built on three distinct layers to ensure maximum separation of concerns:

### 1. The Facade (`DataEngine`)
The `DataEngine` is the single entry point for the user. It manages:
- **Plugin Registry:** An ordered list of transformations.
- **Global Schema:** The Zod schema used for core validation.
- **Event Lifecycle:** Emitting `start`, `progress`, `plugin:after`, `error`, and `end`.
- **Controller Wiring:** Delegating tasks to specialized controllers.

### 2. The Controllers (`src/core/controllers/`)
Controllers handle the orchestration for specific I/O environments:
- **BinaryController:** Optimized for `Buffer` and `Object` operations.
- **FileController:** Optimized for `fs.ReadStream` and `fs.WriteStream`.
- **StreamController:** Optimized for raw Node.js `Transform` and `PassThrough` pipes.

### 3. Core Primitives (`src/core/core.ts`)
The core contains **stateless pure functions** and stream factories. It has no knowledge of the `DataEngine` or its state. This makes the core logic highly reusable and easy to unit test.

---

## 📜 The Manifest System

When you "pack" data using PipeX, the engine prepends a **PipeX Manifest** frame (encoded in MsgPack) to the beginning of the byte stream.

```typescript
export interface PipeXManifest {
  readonly __pipex_v: 1;      // Protocol version
  readonly plugins:   string[]; // name@version in execution order
  readonly ts:        number;   // Unix timestamp
}
```

### Why it matters:
- **Validation:** Unpack rejects malformed manifests and plugin-chain mismatches before emitting data.
- **Scope:** `pack()` serializes object frames and does not apply encryption or compression. Apply plugins through `process()` or `stream.pipe()` before using a separate transport format.

---

## 🔌 Plugin Contract

Every plugin must implement the `ProcessorPlugin` interface:

```typescript
export interface ProcessorPlugin {
  readonly name:    string;
  readonly version: string;
  
  // For in-memory Buffer processing
  process(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  reverse?(data: Buffer, ctx: ProcessorContext): Promise<Buffer> | Buffer;
  
  // For zero-copy Stream processing
  createStream?(mode: 'compress' | 'decompress'): Transform;
}
```

### Stream Fallback
If a plugin does **not** implement `createStream`, PipeX automatically wraps the `process`/`reverse` methods in a `Transform` stream. This ensures that every plugin works in a streaming context, though implementing a native `createStream` is always more efficient.

---

## 🚀 Performance Design

1. **Zero-Copy Subarrays:** PipeX uses `Buffer.subarray()` wherever possible to avoid expensive memory copies.
2. **MsgPack over JSON:** Internal serialization uses `msgpackr`, which is significantly faster and produces smaller payloads than `JSON.stringify`.
3. **Sliding Windows:** Complex plugins (like `HashingPlugin` and `EncryptionPlugin`) use sliding buffer windows in stream mode to handle trailing data (like AuthTags and HMACs) without loading the entire stream into RAM.
