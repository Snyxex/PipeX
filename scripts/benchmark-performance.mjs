import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { availableParallelism, cpus, tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
const modulePath = resolve(option('--module', join(root, 'dist/index.mjs')));
const outputPath = resolve(option('--output', join(root, '.temp/performance/current.json')));
const filter = option('--filter', '');
const filters = filter.split(',').filter(Boolean);
const matches = id => filters.length === 0 || filters.some(value => id.includes(value));
const sampleMs = Number(option('--sample-ms', '250'));
if (!Number.isSafeInteger(sampleMs) || sampleMs < 100 || sampleMs > 5000) throw new Error('sample-ms must be 100..5000');
const digest = data => createHash('sha256').update(data).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const MiB = 1024 * 1024;
const totalBytes = 64 * MiB;

if (!args.includes('--worker')) {
  const against = option('--against', '');
  const comparePath = option('--compare', '');
  assert.ok(!(against && comparePath), 'Choose --against or --compare');
  const baselineModule = against ? resolve(against) : undefined;
  assert.notEqual(baselineModule, modulePath, 'Baseline and candidate must be separate bundle paths');
  const baselineRuns = [], runs = [];
  async function runWorker(path) {
    return new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, [
        '--expose-gc', fileURLToPath(import.meta.url), '--worker',
        '--module=' + path, '--sample-ms=' + sampleMs, '--filter=' + filter,
      ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) { reject(new Error('Benchmark worker exited ' + code)); return; }
        try { resolveRun(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    });
  }
  for (let index = 0; index < 5; index++) {
    const paths = baselineModule ? [baselineModule, modulePath] : [modulePath];
    if (baselineModule && index % 2 === 1) paths.reverse();
    for (const path of paths) {
      const result = await runWorker(path);
      (path === baselineModule ? baselineRuns : runs).push(result);
    }
    console.error('Completed benchmark ' + (baselineModule ? 'pair ' : 'process ') + (index + 1) + '/5');
  }
  async function aggregate(measurements, path) {
    const metrics = ['durationMs', 'roundtripUs', 'p95RoundtripUs', 'throughputMiBPerSecond', 'cpuUserMs', 'cpuSystemMs', 'cpuUsPerRoundtrip', 'eventLoopP99Ms', 'peakRssBytes', 'peakHeapBytes', 'peakExternalBytes', 'peakArrayBufferBytes'];
    const scenarios = measurements[0].scenarios.map((scenario, index) => ({
      id: scenario.id, inputBytes: scenario.inputBytes,
      ...Object.fromEntries(metrics.map(metric => [metric, median(measurements.map(run => {
        assert.equal(run.scenarios[index].id, scenario.id);
        return run.scenarios[index][metric];
      }))])),
    }));
    return {
      formatVersion: 4, createdAt: new Date().toISOString(), modulePath: path,
      moduleSha256: digest(await readFile(path)), runtime: measurements[0].runtime,
      settings: { processes: 5, sampleMs, warmupMs: 100, yieldEveryBinaryOperations: 128,
        memorySampleMs: 20, streamBytes: totalBytes, filter,
        measuredUnit: 'forward+reverse roundtrip; throughput counts original input once' },
      peakProcessRssBytes: median(measurements.map(run => run.peakProcessRssBytes)),
      scenarios, runs: measurements,
    };
  }
  const report = await aggregate(runs, modulePath);
  let baseline, baselinePath;
  if (baselineModule) {
    baseline = await aggregate(baselineRuns, baselineModule);
    baselinePath = outputPath.replace(/\.json$/, '') + '-baseline.json';
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  } else if (comparePath) {
    baselinePath = resolve(comparePath);
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  }
  if (baseline) {
    assert.equal(baseline.formatVersion, report.formatVersion, 'Compare identical benchmark format versions');
    assert.deepEqual(baseline.runtime, report.runtime, 'Compare on identical runtime and hardware');
    assert.deepEqual(baseline.settings, report.settings, 'Compare identical benchmark settings');
    assert.ok(baseline.peakProcessRssBytes > 0 && report.peakProcessRssBytes > 0, 'OS peak RSS must be available');
    report.baseline = { path: baselinePath, moduleSha256: baseline.moduleSha256 };
    report.peakProcessRssChangePercent = (report.peakProcessRssBytes / baseline.peakProcessRssBytes - 1) * 100;
    report.comparison = report.scenarios.map(scenario => {
      const before = baseline.scenarios.find(item => item.id === scenario.id);
      assert.ok(before, 'Missing baseline scenario ' + scenario.id);
      return {
        id: scenario.id,
        latencyImprovementPercent: (1 - scenario.roundtripUs / before.roundtripUs) * 100,
        throughputImprovementPercent: (scenario.throughputMiBPerSecond / before.throughputMiBPerSecond - 1) * 100,
        peakRssChangePercent: (scenario.peakRssBytes / before.peakRssBytes - 1) * 100,
      };
    });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputPath, scenarios: report.scenarios.length,
    peakProcessRssChangePercent: report.peakProcessRssChangePercent, comparison: report.comparison }));

} else {
  const { DataEngine, definePlugin, CompressionPlugin, EncryptionPlugin, HashingPlugin } = await import(pathToFileURL(modulePath).href);
  // Data generation, keys, input files and expected checksums are outside measured regions.
  const compressible = Buffer.alloc(totalBytes, 0x5a);
  const random = Buffer.allocUnsafe(totalBytes);
  let state = 0x12345678;
  for (let index = 0; index < random.length; index++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    random[index] = state & 0xff;
  }
  const corpora = [['compressible', compressible], ['random', random]];
  const key = randomBytes(32);
  const secret = randomBytes(32).toString('hex');
  const fileRoot = await mkdtemp(join(tmpdir(), 'pipex-performance-'));
  const makeEngine = mode => {
    const engine = new DataEngine({ maxInputBytes: 96 * MiB, maxOutputBytes: 96 * MiB });
    if (mode === 'ceh') return engine.use(new CompressionPlugin({ type: 'gzip', level: 6 }))
      .use(new EncryptionPlugin({ algorithm: 'aes-256-gcm', key }))
      .use(new HashingPlugin({ algorithm: 'sha256', secret }));
    const count = mode === 'empty' ? 0 : Number(mode.at(-1));
    for (let index = 0; index < count; index++) engine.use(definePlugin({
      name: 'identity-' + index, version: '1', streaming: true,
      process: mode.startsWith('async') ? async data => data : data => data,
      reverse: mode.startsWith('async') ? async data => data : data => data,
    }));
    return engine;
  };
  const scenarios = [];
  async function measure(id, inputBytes, work, verify, binary) {
    if (!matches(id)) return;
    await verify(await work());
    if (binary) {
      const warmStart = performance.now();
      let warmed = 0;
      do {
        await work();
        if (++warmed % 128 === 0) await new Promise(resolveTurn => setImmediate(resolveTurn));
      } while (performance.now() - warmStart < 100);
    } else await work();
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    global.gc?.();
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    global.gc?.();
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const samples = new Float64Array(4096);
    let count = 0;
    let peakRssBytes = 0, peakHeapBytes = 0, peakExternalBytes = 0, peakArrayBufferBytes = 0;
    const sampleMemory = () => {
      const memory = process.memoryUsage();
      peakRssBytes = Math.max(peakRssBytes, memory.rss);
      peakHeapBytes = Math.max(peakHeapBytes, memory.heapUsed);
      peakExternalBytes = Math.max(peakExternalBytes, memory.external);
      peakArrayBufferBytes = Math.max(peakArrayBufferBytes, memory.arrayBuffers);
    };
    sampleMemory();
    const memoryTimer = setInterval(sampleMemory, 20);
    const cpu = process.cpuUsage();
    const start = performance.now();
    let last;
    do {
      const operationStart = performance.now();
      last = await work();
      samples[count % samples.length] = (performance.now() - operationStart) * 1000;
      count++;
      if (binary && count % 128 === 0) await new Promise(resolveTurn => setImmediate(resolveTurn));
    } while (performance.now() - start < sampleMs);
    const durationMs = performance.now() - start;
    const cpuUsed = process.cpuUsage(cpu);
    sampleMemory();
    clearInterval(memoryTimer);
    await new Promise(resolveTurn => setTimeout(resolveTurn, 12));
    lag.disable();
    await verify(last);
    const latencies = Array.from(samples.subarray(0, Math.min(count, samples.length))).sort((a, b) => a - b);
    scenarios.push({
      id, inputBytes, operations: count, durationMs,
      roundtripUs: durationMs * 1000 / count,
      p95RoundtripUs: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * .95))],
      throughputMiBPerSecond: inputBytes * count / MiB / (durationMs / 1000),
      cpuUserMs: cpuUsed.user / 1000, cpuSystemMs: cpuUsed.system / 1000,
      cpuUsPerRoundtrip: (cpuUsed.user + cpuUsed.system) / count,
      eventLoopP99Ms: lag.percentile(99) / 1e6,
      peakRssBytes, peakHeapBytes, peakExternalBytes, peakArrayBufferBytes,
    });
  }
  try {
    for (const bytes of [1024, 32 * 1024, MiB]) {
      const data = random.subarray(0, bytes);
      for (const mode of ['empty', 'sync1', 'sync4', 'async1', 'async4']) {
        const engine = makeEngine(mode);
        await measure('binary/' + bytes + '/' + mode, bytes,
          async () => engine.binary.undo(await engine.binary.run(data)),
          restored => assert.deepEqual(restored, data), true);
      }
      for (const [corpus, full] of corpora) {
        const data = full.subarray(0, bytes);
        const engine = makeEngine('ceh');
        await measure('binary/' + bytes + '/ceh/' + corpus, bytes,
          async () => engine.binary.undo(await engine.binary.run(data)),
          restored => assert.deepEqual(restored, data), true);
      }
    }
    for (const chunkBytes of [4 * 1024, 64 * 1024]) for (const [corpus, data] of corpora) {
      for (const mode of ['empty', 'sync1', 'sync4', 'async1', 'async4', 'ceh']) {
        const engine = makeEngine(mode);
        const expected = digest(data);
        // Receivers split encoded data differently; identity output is checked incrementally.
        const work = async () => {
          async function* source() {
            for (let offset = 0; offset < data.length; offset += chunkBytes) yield data.subarray(offset, offset + chunkBytes);
          }
          const forward = [];
          await engine.stream.pipe(Readable.from(source()), new Writable({
            write(chunk, _encoding, callback) { forward.push(chunk); callback(); },
          }));
          const hash = createHash('sha256');
          let bytes = 0;
          async function* encoded() {
            for (const chunk of forward) {
              const half = Math.max(1, Math.floor(chunk.length / 2));
              for (let offset = 0; offset < chunk.length; offset += half) yield chunk.subarray(offset, offset + half);
            }
          }
          await engine.stream.pipe(Readable.from(encoded()), new Writable({
            write(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(); },
          }), true);
          return { hash: hash.digest('hex'), bytes };
        };
        await measure('stream/' + chunkBytes + '/' + mode + '/' + corpus, data.length, work,
          result => { assert.equal(result.hash, expected); assert.equal(result.bytes, data.length); }, false);
      }
    }
    for (const [corpus, data] of corpora) {
      if (!['empty', 'sync1', 'sync4', 'async1', 'async4', 'ceh'].some(mode => matches('file/' + mode + '/' + corpus))) continue;
      const input = join(fileRoot, corpus + '.input');
      const encoded = join(fileRoot, corpus + '.encoded');
      const restored = join(fileRoot, corpus + '.restored');
      await writeFile(input, data);
      const expected = digest(data);
      for (const mode of ['empty', 'sync1', 'sync4', 'async1', 'async4', 'ceh']) {
        const engine = makeEngine(mode);
        await measure('file/' + mode + '/' + corpus, data.length, async () => {
          await engine.file.process(input, encoded, fileRoot);
          await engine.file.reverse(encoded, restored, fileRoot);
        }, async () => assert.equal(digest(await readFile(restored)), expected), false);
      }
    }
    if (scenarios.length === 0) throw new Error('No benchmark scenarios match filter: ' + filter);
    console.log(JSON.stringify({
      runtime: { node: process.version, execPath: process.execPath, v8: process.versions.v8, openssl: process.versions.openssl, platform: process.platform, arch: process.arch,
        cpu: cpus()[0]?.model, parallelism: availableParallelism() },
      peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
      scenarios,
    }));
  } finally { await rm(fileRoot, { recursive: true, force: true }); }
}
