import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';


import { DataEngine,
            EncryptionPlugin,
            CompressionPlugin,
            HashingPlugin,
            BenchmarkPlugin,
            WorkerPoolPlugin
} from '../src/index.js';


// ─── Shared config ────────────────────────────────────────────────────────────

const AES_KEY      = randomBytes(32);           // 32-byte key for AES-256-GCM
const CHACHA_KEY   = randomBytes(32);           // 32-byte key for ChaCha20-Poly1305
const HMAC_SECRET  = '7483050472089075374'; // >= 16 chars

// ─── 1. Single plugin — encrypt & decrypt ────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 1. Single plugin: AES-256-GCM encrypt');
console.log('════════════════════════════════════════');
{
  const engine = new DataEngine();
  engine.use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: AES_KEY }));

  const result = await engine.binary.run('Hello, DataEngine!');
  console.log('Encrypted (hex):', result.data.toString('hex').slice(0, 40) + '…');
  console.log('Pipeline:       ', result.pipeline);
  console.log('Duration:       ', result.metrics.durationMs + 'ms');

  const original = await engine.binary.undo(result.data, 'string');
  console.log('Decrypted:      ', original.toString());
}

// ─── 2. Single plugin — compress & decompress ────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 2. Single plugin: gzip compression');
console.log('════════════════════════════════════════');
{
  const engine = new DataEngine();
  engine.use(new CompressionPlugin({ type: 'gzip', level: 6 }));

  const payload = 'a'.repeat(10_000); // highly compressible
  const result  = await engine.binary.run(payload);
  const ratio   = ((1 - result.data.length / payload.length) * 100).toFixed(1);
  console.log(`Input:  ${payload.length} bytes`);
  console.log(`Output: ${result.data.length} bytes  (${ratio}% smaller)`);

  const original = await engine.binary.undo(result.data, 'string');
  console.log('Recovered:', original.toString().slice(0, 20) + '…');
}

// ─── 3. Single plugin — HMAC integrity ───────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 3. Single plugin: HMAC hashing');
console.log('════════════════════════════════════════');
{
  const engine = new DataEngine();
  engine.use(new HashingPlugin({ algorithm: 'sha256', secret: HMAC_SECRET }));

  const result = await engine.binary.run('important document');
  console.log('Data + HMAC length:', result.data.length, 'bytes');

  const original = await engine.binary.undo(result.data, 'string');
  console.log('Verified & recovered:', original.toString());

  // Tamper detection
  const tampered = Buffer.from(result.data);
  tampered[0] = (tampered[0] as number) ^ 0xff;
  try {
    await engine.binary.undo(tampered, 'string');
  } catch (e: any) {
    console.log('Tamper detected ✅:', e.message.split(':')[1]?.trim() || e.message);
  }
}

// ─── 4. Full pipeline — compress → hash → encrypt ────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 4. Full pipeline: compress → hash → encrypt');
console.log('════════════════════════════════════════');
{
  const engine = new DataEngine()
    .use(new BenchmarkPlugin())                                          // transparent, records metrics
    .use(new CompressionPlugin({ type: 'brotli', level: 4 }))           // step 1: compress
    .use(new HashingPlugin({ algorithm: 'sha256', secret: HMAC_SECRET })) // step 2: HMAC
    .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: AES_KEY }));   // step 3: encrypt

  const payload = 'Sensitive payload: ' + 'x'.repeat(5_000);
  const result  = await engine.binary.run(payload);

  console.log('Input size: ', payload.length, 'bytes');
  console.log('Final size: ', result.data.length, 'bytes');
  console.log('Pipeline:   ', result.pipeline.join(' → '));
  console.log('Step times: ', result.metrics.steps);

  // undo() runs in reverse: decrypt → verify HMAC → decompress
  const recovered = await engine.binary.undo<string>(result.data, 'string');
  console.log('Recovered:  ', recovered.toString().slice(0, 30) + '…');
  console.log('Match:      ', recovered.toString() === payload);
}

// ─── 5. ChaCha20-Poly1305 variant ────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 5. ChaCha20-Poly1305 + SHA-512');
console.log('════════════════════════════════════════');
{
  const engine = new DataEngine()
    .use(new CompressionPlugin({ type: 'gzip' }))
    .use(new HashingPlugin({ algorithm: 'sha512', secret: HMAC_SECRET }))
    .use(new EncryptionPlugin({ algorithm: 'chacha20-poly1305', key: CHACHA_KEY }));

  const result    = await engine.binary.run(Buffer.from('chacha + sha512 example'));
  const recovered = await engine.binary.undo(result.data, 'buffer');
  console.log('Recovered:', recovered.toString());
}

// ─── 6. Worker pool for CPU-intensive processing ──────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 6. WorkerPoolPlugin (multi-core XOR)');
console.log('════════════════════════════════════════');
{
  const engine = new DataEngine()
    .use(new WorkerPoolPlugin({ maxThreads: 2 }))  // XOR across worker threads
    .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: AES_KEY }));

  const payload   = randomBytes(64 * 1024); // 64 KB
  const result    = await engine.binary.run(payload);
  const recovered = await engine.binary.undo<Buffer>(result.data, 'buffer');
  console.log('64 KB round-trip ok:', recovered.equals(payload));
  console.log('Duration:           ', result.metrics.durationMs + 'ms');
}

// ─── 7. Stream mode ───────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 7. Stream mode');
console.log('════════════════════════════════════════');
{
  // engine.stream.pipe() pipes a Readable through all plugin streams into a Writable.
  // Useful for large files where you don't want to load everything into memory.

  const chunks: Buffer[] = [];
  const input  = Readable.from([Buffer.from('streamed data chunk 1'), Buffer.from(' chunk 2')]);
  const output = new (await import('node:stream')).Writable({
    write(chunk, _, cb) { chunks.push(chunk); cb(); }
  });

  const engine = new DataEngine()
    .use(new CompressionPlugin({ type: 'gzip' }))
    .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key: AES_KEY }));

  await engine.stream.pipe(input, output);
  const streamResult = Buffer.concat(chunks);
  console.log('Stream output size:', streamResult.length, 'bytes');

  // Decrypt + decompress the result using buffer-mode undo
  const recovered = await engine.binary.undo<string>(streamResult, 'string');
  console.log('Stream recovered:  ', recovered.toString());
}

// ─── 8. Encryption only — algorithm comparison ───────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 8. AES vs ChaCha — same key, same data');
console.log('════════════════════════════════════════');
{
  const key  = randomBytes(32);
  const data = 'same plaintext for both algorithms';

  const aesEngine = new DataEngine().use(new EncryptionPlugin({ algorithm: 'aes-256-gcm',       key }));
  const ccEngine  = new DataEngine().use(new EncryptionPlugin({ algorithm: 'chacha20-poly1305', key }));

  const aesResult = await aesEngine.binary.run(data);
  const ccResult  = await ccEngine.binary.run(data);

  console.log('AES ciphertext size:    ', aesResult.data.length);
  console.log('ChaCha ciphertext size: ', ccResult.data.length);
  console.log('AES recovered:          ', (await aesEngine.binary.undo(aesResult.data, 'string')).toString());
  console.log('ChaCha recovered:       ', (await ccEngine.binary.undo(ccResult.data, 'string')).toString());
}

// ─── 9. Compression algorithm comparison ─────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(' 9. gzip vs brotli — size comparison');
console.log('════════════════════════════════════════');
{
  const payload = Buffer.from('hello world '.repeat(1000));

  for (const type of ['gzip', 'brotli'] as const) {
    const engine = new DataEngine().use(new CompressionPlugin({ type }));
    const result = await engine.binary.run(payload);
    const ratio  = ((1 - result.data.length / payload.length) * 100).toFixed(1);
    console.log(`${type.padEnd(6)}: ${result.data.length} bytes  (${ratio}% reduction)`);
  }
}

console.log('\n✅ All examples complete\n');