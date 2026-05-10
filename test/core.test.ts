/**
 * examples.ts — illustrates the full PipeX controller API
 * (Not runnable as-is — requires concrete plugin implementations)
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { DataEngine } from '../src/core/core.js';
import type { ProcessorPlugin, EngineResult }  from '../src/core/types.js';

// ─── Minimal plugin example ───────────────────────────────────────────────────

const uppercasePlugin: ProcessorPlugin = {
  name:    'uppercase',
  version: '1.0.0',
  process: (buf) => Buffer.from(buf.toString().toUpperCase()),
  reverse: (buf) => Buffer.from(buf.toString().toLowerCase()),
};

// ─── Setup ────────────────────────────────────────────────────────────────────

const engine = new DataEngine()
  .use(uppercasePlugin);

// ─── Events ───────────────────────────────────────────────────────────────────

engine.on('start',        (id)          => console.log('▶ start', id));
engine.on('plugin:after', (name, ms)    => console.log(`  ✓ ${name} in ${ms}ms`));
engine.on('progress',     (bytes, id)   => console.log(`  ~ ${bytes} bytes [${id}]`));
engine.on('end',          (id, ms)      => console.log(`■ end ${id} (${ms ?? '?'}ms)`));
engine.on('error',        (err, id)     => console.error(`✗ error [${id}]:`, err.message));
engine.on('manifest',     (m)           => console.log('manifest:', m));

// ─── engine.binary ────────────────────────────────────────────────────────────

async function binaryExamples() {
  // Synchronous msgpack round-trip
  const buf = engine.binary.pack({ id: 1, tags: ['a', 'b'] });
  const val = engine.binary.unpack<{ id: number; tags: string[] }>(buf);

  // Plugin pipeline
  const result: EngineResult = await engine.binary.run({ hello: 'world' });
  const original = await engine.binary.undo(result);     // ← uses result.originalType
  
  // External buffer with forced type
  const restored = await engine.binary.undo<string>(result.data, 'json');

  // Embed manifest in binary for transport
  const withManifest = engine.binary.packWithManifest({ payload: 'data' });
  const { manifest, data } = engine.binary.unpackWithManifest(withManifest);
  console.log('transported manifest:', manifest.plugins);
}

// ─── engine.file ──────────────────────────────────────────────────────────────

async function fileExamples() {
  // Forward through plugin chain
  await engine.file.process('input.txt', 'output.bin');

  // Reverse through plugin chain
  await engine.file.reverse('output.bin', 'restored.txt');

  // Pack to msgpack with manifest header
  await engine.file.pack('data.json', 'data.msgpack');

  // Unpack msgpack → NDJSON (manifest is emitted as an event)
  await engine.file.unpack('data.msgpack', 'data.ndjson');

  // Path containment — safe directory boundary
  await engine.file.process('uploads/file.txt', 'out/result.bin', '/var/app/uploads');
}

// ─── engine.stream ────────────────────────────────────────────────────────────

async function streamExamples() {
  // Pipe a Readable through plugins into a Writable
  await engine.stream.pipe(
    createReadStream('input.bin'),
    createWriteStream('output.bin'),
  );

  // Reverse pipeline
  await engine.stream.pipe(
    createReadStream('output.bin'),
    createWriteStream('restored.bin'),
    true, // reverse=true
  );

  // Streaming endpoint — pipe any Readable into it
  const dest = createWriteStream('live-output.bin');
  const sink = engine.stream.into(dest);
  createReadStream('large-input.bin').pipe(sink);

  // Object stream → msgpack with manifest
  const { Readable } = await import('node:stream');
  const objects = Readable.from([{ id: 1 }, { id: 2 }, { id: 3 }]);
  objects
    .pipe(engine.stream.pack())
    .pipe(createWriteStream('packed.msgpack'));

  // msgpack bytes → decoded objects with manifest event
  createReadStream('packed.msgpack')
    .pipe(engine.stream.unpack())
    .on('data', (obj: unknown) => console.log('decoded:', obj));
}