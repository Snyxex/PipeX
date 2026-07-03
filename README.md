# PipeX

PipeX is a modular TypeScript data transformation engine for Node.js. It lets you run data through ordered plugin pipelines for compression, encryption, hashing, validation, worker-thread processing, and observability.

The API is split into three controllers:

- `engine.binary`: in-memory values and buffers.
- `engine.file`: file-to-file streaming.
- `engine.stream`: low-level Node.js stream pipelines.

## Install
```
In Future maybe on npm

for now use this:

git clone https://github.com/Snyxex/PipeX.git
```
PipeX requires Node.js 20 or newer.

## Quick Start

```ts
import { randomBytes } from 'node:crypto';
import { DataEngine, Plugins } from 'pipex';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
});

const engine = new DataEngine()
  .setSchema(UserSchema)
  .use(new Plugins.Compression({ type: 'brotli' }))
  .use(new Plugins.Encryption({
    algorithm: 'aes-256-gcm',
    key: randomBytes(32),
  }));

const result = await engine.binary.run({ id: 1, username: 'dev' });
const restored = await engine.binary.undo<z.infer<typeof UserSchema>>(result);
```

## Documentation

- [Documentation Index](./docs/index.md)
- [Use Cases](./docs/use-cases.md)
- [API Reference](./docs/api.md)
- [Plugin Reference](./docs/plugins.md)
- [Architecture](./docs/architecture.md)
- [Enterprise Features](./docs/enterprise.md)

## Scripts

```bash
npm run typecheck
npm run build
npm test
```

## License

MIT
