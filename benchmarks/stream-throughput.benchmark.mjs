import { performance } from 'node:perf_hooks';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { CompressionPlugin, DataEngine } from '../dist/index.mjs';

const MIB = 1024 * 1024;
const requestedBytes = Number(process.env.PIPEX_BENCHMARK_BYTES ?? 1024 * MIB);
if (!Number.isSafeInteger(requestedBytes) || requestedBytes < MIB || requestedBytes > 8 * 1024 * MIB) {
  throw new Error('PIPEX_BENCHMARK_BYTES must be between 1 MiB and 8 GiB');
}

test('manual large streaming throughput benchmark', { timeout: 600_000 }, async () => {
  const chunk = Buffer.alloc(64 * 1024, 0x5a);
  async function* source() {
    let remaining = requestedBytes;
    while (remaining > 0) {
      const length = Math.min(remaining, chunk.length);
      yield chunk.subarray(0, length);
      remaining -= length;
    }
  }

  let outputBytes = 0;
  const destination = new Writable({
    write(data, _encoding, callback) {
      outputBytes += data.length;
      callback();
    },
  });
  const engine = new DataEngine({ maxInputBytes: requestedBytes, maxOutputBytes: requestedBytes })
    .use(new CompressionPlugin({ type: 'gzip', level: 1 }));
  const started = performance.now();
  await engine.stream.pipe(Readable.from(source()), destination, false, { timeoutMs: 590_000 });
  const durationSeconds = (performance.now() - started) / 1_000;
  console.log(JSON.stringify({
    inputMiB: requestedBytes / MIB,
    outputBytes,
    durationSeconds,
    throughputMiBPerSecond: requestedBytes / MIB / durationSeconds,
  }));
});
