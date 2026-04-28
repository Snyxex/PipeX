import { DataEngine, WorkerPoolPlugin } from '../src/index.js';

import { Buffer } from 'node:buffer';
import { availableParallelism } from 'node:os';

async function runMultiCoreBenchmark() {
  const engine = new DataEngine();
  engine.use(new WorkerPoolPlugin({ maxThreads: 2 }));

  const GB_SIZE = 8; 
  const TOTAL_BYTES = GB_SIZE * 1024 * 1024 * 1024;
  const cores = availableParallelism();

  console.log(`\n☢️  STARTING MULTI-CORE WORKER POOL TEST`);
  console.log(`==================================================`);
  console.log(`📦 Datenmenge:       ${GB_SIZE} GB`);
  console.log(`🧠 CPU-Kerne:        ${cores} Threads`);
  console.log(`🛠️  Modus:            Parallel Worker Partitioning`);
  console.log(`⏱️  Verarbeitung läuft...`);

  // Wir erstellen die Testdaten
  // Hinweis: Bei 8GB stellt Node.js sicher, dass dein RAM das hergibt.
  const testData = Buffer.alloc(TOTAL_BYTES, 'A');

  const start = performance.now();
  
  // Die Engine verteilt die Arbeit nun automatisch auf alle Kerne
  const result = await engine.run(testData);
  
  const end = performance.now();

  const durationMs = end - start;
  const durationSec = durationMs / 1000;
  const throughput = (TOTAL_BYTES / 1024 / 1024) / durationSec;

  console.log(`\n✅ Ergebnis:`);
  console.log(`--------------------------------------------------`);
  console.log(`Total Time:     ${durationMs.toFixed(2)} ms`);
  console.log(`Effektiver Speed: ${throughput.toFixed(2)} MB/s`);
  
  // Validierung: Haben die Worker wirklich gearbeitet?
  // Da XOR symmetrisch ist, testen wir ein Byte ( 'A' ^ 0x42 )
  const expectedByte = 'A'.charCodeAt(0) ^ 0x42;
  if (result.data[0] === expectedByte) {
    console.log(`Integrität:     ✅ Korrekt (Daten wurden manipuliert)`);
  } else {
    console.log(`Integrität:     ❌ Fehler (Daten unverändert oder falsch)`);
  }

  console.log(`==================================================\n`);
  
  // Prozess explizit beenden, da Worker-Threads manchmal den Event-Loop offen halten
  process.exit(0);
}

runMultiCoreBenchmark().catch((err) => {
  console.error("Benchmark Crash:", err);
  process.exit(1);
});