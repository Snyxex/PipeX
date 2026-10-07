# Performance measurements

PipeX keeps its APIs, limits, wire formats, compression defaults and cryptographic
settings unchanged. The optimizations target common pipeline overhead:

- Synchronous results avoid pending-work bookkeeping and deadline timers. Abort
  and deadline checks remain before execution, after execution and after awaiting.
- Timeout-only requests reuse their fresh timeout signal instead of composing a
  single signal. Caller cancellation and deadline registration remain unchanged.
- Native stream observation and cumulative output limits share one Transform.
  Progress order, backpressure and span completion remain covered by regressions.
- Fallback chunks reuse their selected function without allocating a bound function.
- Logger/tracer guards are cached with weak references. Synchronous observer
  returns avoid Promise allocation; rejected Promises and thenables stay isolated.

## Run the benchmark

Run from the repository checkout. Build the version to measure, then run:

```sh
npm run build
npm run benchmark:performance -- --output=.temp/performance/current.json
```

The command runs 57 scenarios in five separate processes with warm-up, explicit
GC after event-loop turns, at least 100 ms binary warm-up, and at least
250 ms of measured work per scenario. Warm-up and measured binary work both
yield every 128 operations, allowing deadline signals and finalizers to settle.
Input data, keys, expected digests and file setup are prepared outside timing.
Every scenario verifies its forward/reverse result before and after measurement;
stream receivers deliberately split encoded chunks differently.

The matrix covers 1 KiB, 32 KiB and 1 MiB binary inputs; no plugins; one/four
synchronous and asynchronous identity plugins; Gzip level 6, AES-256-GCM and
SHA-256 HMAC; 4/64 KiB stream chunks; and 64 MiB file roundtrips. Data uses a
repeated byte and a fixed-seed xorshift corpus. These are reproducible workloads,
not a guarantee of production throughput.

JSON includes the runtime/hardware, bundle SHA-256, settings, raw per-process
results and medians for wall time, roundtrip latency, p95 latency, throughput,
CPU use, event-loop delay and memory, plus the OS-reported whole-process peak RSS. Throughput counts original input once per
forward+reverse roundtrip. Stream timing includes checksum calculation and an
in-memory encoded transport; its RSS includes retained encoded data. File timing
includes native handle setup and atomic replacement, but excludes input creation
and final checksum verification. Memory fields are 20 ms sampled high-water
observations, not exact allocator maxima; peakProcessRssBytes separately reports
the OS process high-water mark. p95 uses up to the last 4,096 operations.

## Compare two builds

Save the baseline bundle before changing source:

```sh
mkdir -p .temp/performance/baseline
cp dist/index.mjs .temp/performance/baseline/index.mjs
npm run benchmark:performance -- --module=.temp/performance/baseline/index.mjs --output=.temp/performance/baseline.json
npm run build
npm run benchmark:performance -- --output=.temp/performance/current.json --compare=.temp/performance/baseline.json
```

For a new comparison, prefer alternating baseline/candidate processes:

```sh
node scripts/benchmark-performance.mjs --against=.temp/performance/baseline/index.mjs --output=.temp/performance/paired.json
```

This runs five fresh processes per version, alternating order for each pair,
and writes paired-baseline.json plus paired.json. It reduces time-order drift.
Saved-report comparisons with --compare remain available.

The copy example uses POSIX commands; on PowerShell use New-Item/Copy-Item.
If shell wrappers consume npm arguments, call node scripts/benchmark-performance.mjs
directly with the same options.
Keep both builds under the same checkout so they resolve identical locked
dependencies. Comparison requires matching runtime/hardware and benchmark
settings. Keep unrelated CPU/disk work idle during measurements.

Use --filter=substring (or comma-separated substrings) to repeat a suspicious subset; create both a baseline and
candidate report with that same filter. --sample-ms=1000 increases each sample.
Timing thresholds remain outside CI. A repeatable improvement of at least 10%
is the target for small synchronous binary and fallback-stream pipelines; other
workloads and peak memory must not reproducibly regress by more than 5%.

## Validation and remaining costs

The full quality suites cover sync/async plugins, custom thenables, retries,
cancellation, deadlines, retained capacity after timeout, observer failures,
fragmented streams, slow receivers, byte limits and crypto/file regressions.
Native file capability checks and full-message HMAC verification remain intact.

The final runtime implementation passed `npm run quality:ci` on Windows and
Linux with Node 20.19.0, 22.23.3 and 24.21.0 (123 tests per combination, npm
11.16.0), plus Windows Node 26.3.0. This includes tooling, unit, integration,
security, package, clean runtime/TypeScript consumers and the performance smoke
suite. Exported TypeScript declarations are byte-identical to the baseline.
Checks used isolated copies with the unchanged HEAD CI fixture restored; the
pre-existing local deletion of `.github/workflows/ci.yml` is outside this change.
Node 20 reports existing build-tool engine/deprecation warnings; its checks pass.

Cloud providers, custom application plugins and OS storage latency can dominate
real workloads. Synchronous plugin CPU work still cannot be preempted.

## Recorded comparison

Measured on Windows x64, AMD Ryzen 5 5600X (12 logical CPUs), Node 26.3.0,
V8 14.6.202.34-node.20, OpenSSL 3.5.6. Baseline is plugin branch commit
`86f275c6f542997fe141fa93259446150420c3f9`. Five alternating process pairs ran
all 57 scenarios with the default 250 ms minimum sample. Latencies below are
forward+reverse roundtrips, not single plugin calls.

| Scenario | Before | After | Latency reduction |
| --- | ---: | ---: | ---: |
| Binary 1 KiB, empty | 17.88 µs | 9.51 µs | 46.8% |
| Binary 1 KiB, sync ×1 | 22.69 µs | 13.06 µs | 42.5% |
| Binary 1 KiB, sync ×4 | 41.66 µs | 19.61 µs | 52.9% |
| Stream 64 MiB, 4 KiB chunks, sync ×4, random | 859.16 ms | 335.73 ms | 60.9% |
| Stream 64 MiB, 64 KiB chunks, sync ×4, random | 149.45 ms | 56.78 ms | 62.0% |
| File 64 MiB, Gzip → AES-GCM → HMAC, random | 2,673.04 ms | 2,253.47 ms | 15.7% |

Median whole-process peak RSS fell from 986.27 MiB to 566.09 MiB (42.6%).
No scenario increased sampled RSS, heap, external or ArrayBuffer peaks by more
than 5%. These whole-process values include both 64 MiB corpora and in-memory
stream transport; later scenarios also reflect earlier workloads.

The 10% target is exceeded for all measured small synchronous Binary and
synchronous fallback-stream cases. The full run flagged two latency cases for
repetition: 64 KiB async ×1 compressible streams (-7.5%) and async ×4 random files
(-5.0%, throughput -4.8%). Five new alternating pairs with 1,000 ms samples
reversed both flags: async ×1 compressible streams improved 14.4%, and async ×4
random files improved 10.4%. Their paired corpus variants improved 10.3% and
10.8%, respectively. No repeated scenario regressed in latency or increased
sampled memory by more than 5%; the flagged regressions were not reproduced.
The same repeat confirmed 1 KiB sync ×1 and sync ×4 latency reductions of 44.3%
and 56.8%. The measured acceptance targets are met on this machine/runtime;
performance across other hardware and Node versions remains unmeasured.

Raw reports: `.temp/performance/final-full.json`,
`final-full-baseline.json`, `final-repeat.json`, and
`final-repeat-baseline.json` (ignored local artifacts). Bundle SHA-256:

- Baseline: `e273a217600e1858878ba5903276179e34870a4a2328886cad871e03494220fd`
- Candidate: `b7c596ea8f7b28192d63f157f41086e9665591fbc288e86ddc303b465fd25ef4`

Repeat command:

```sh
node scripts/benchmark-performance.mjs --against=.temp/performance/baseline/index.mjs --output=.temp/performance/final-repeat.json --sample-ms=1000 --filter=binary/1024/,stream/65536/async1/,file/async4/
```

Earlier exploratory reports used superseded candidates or warm-up settings and
are not the acceptance evidence above.
