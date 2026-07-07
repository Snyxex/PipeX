# PipeX 🚀

**PipeX** is a high-performance, modular data transformation engine for TypeScript. It allows you to effortlessly chain compression, encryption, hashing, and validation through a unified, stream-aware architecture.

Unlike simple pipe utilities, PipeX is a **Data Highway** that ensures your data is secure, compact, and self-describing.

---

## ✨ Key Features

- **Standard Plugin Library:** Built-in support for Gzip, Brotli, AES-256-GCM, HMAC, and more.
- **Always-on Validation:** Integrated Zod support for schema-driven data integrity.
- **Manifest System:** Every packed package is self-describing, allowing for "self-healing" decompression/decryption.
- **Multi-Controller API:** Specialized interfaces for **File**, **Binary** (In-Memory), and **Live Streams**.
- **High Performance:** Powered by `msgpackr` for binary serialization and Node.js native streams.
- **Worker Support:** Offload heavy CPU tasks to a persistent worker pool with one line of code.

---

## 📦 Installation

```bash
In future maybe on npm 
npm install pipex zod
```

---

## 🚀 Quick Start

```typescript
import { DataEngine, Plugins } from 'pipex';
import { z } from 'zod';

// 1. Define your data schema
const UserSchema = z.object({
  id: z.number(),
  username: z.string()
});

// 2. Setup the Engine
const engine = new DataEngine()
  .setSchema(UserSchema)
  .use(new Plugins.Compression({ type: 'brotli' }))
  .use(new Plugins.Encryption({ algorithm: 'aes-256-gcm', key: Buffer.from('...') }));

// 3. Transform Data
// Binary (In-Memory)
const result = await engine.binary.run({ id: 1, username: 'dev' });

// File (Zero-RAM streaming)
await engine.file.process('input.json', 'output.pipex');

// 4. Restore Data
const original = await engine.binary.undo(result);
```

---

## 🛠️ Controllers

PipeX is organized into three specialized controllers:

### 💾 Binary Controller
Ideal for small-to-medium datasets that fit in memory.
- `engine.binary.run(data)`: Execute the full pipeline.
- `engine.binary.undo(result)`: Reverse the pipeline.
- `engine.binary.pack(data)`: Fast MsgPack serialization.

### 📂 File Controller
Designed for massive files with zero memory overhead.
- `engine.file.process(src, dst)`: Stream data through the pipeline to a file.
- `engine.file.pack(src, dst)`: Pack a file with a PipeX Manifest header.

### 🌊 Stream Controller
Low-level primitives for live data streams (TCP, WebSockets, etc.).
- `engine.stream.into(writable)`: Create a writable entry point to your pipeline.
- `engine.stream.pipe(readable, writable)`: Manually orchestrate a flow.

---

## 🔌 Standard Plugins

| Plugin | Description | Supported Modes |
| :--- | :--- | :--- |
| `Compression` | Gzip & Brotli compression | Buffer & Stream |
| `Encryption` | AES-256-GCM & ChaCha20 | Buffer & Stream |
| `Hashing` | HMAC-SHA256/512 Integrity | Buffer & Stream |
| `Validation` | Zod Schema enforcement | Buffer |
| `WorkerPool` | Multi-threaded XOR/Processing | Buffer & Stream |
| `Benchmark` | Metrics and byte counting | Buffer |

---

## 📖 Deep Dives

- [Architecture Guide](./docs/architecture.md)
- [Validation System](./docs/validation.md)

---

## 📄 License

MIT © [Snyxex](https://github.com/Snyxex)
