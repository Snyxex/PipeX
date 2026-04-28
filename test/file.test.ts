import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DataEngine, WorkerPoolPlugin } from '../src/index.js';


async function run() {
  const engine = new DataEngine();
  engine.use(new WorkerPoolPlugin({ maxThreads: 4 }));

  const inputPath = path.resolve('test/performance.txt');
  const outputPath = path.resolve('test/performance.enc');

  // Sicherheitscheck: Falls die Datei fehlt, erstelle eine kleine Testdatei
  if (!existsSync(inputPath)) {
    console.log("📝 Erstelle temporäre Testdatei...");
    writeFileSync(inputPath, "Dies ist eine Testdatei für den WorkerPool-Stream-Check. ".repeat(1000));
  }

  try {
    console.log(`🚀 Starte Dateiverarbeitung...`);
    console.log(`Input:  ${inputPath}`);
    console.log(`Output: ${outputPath}`);

   // await engine.processFile(inputPath, outputPath);
   await engine.processFile(outputPath, inputPath);
    console.log("✅ Fertig!");
  } catch (err) {
    console.error("❌ Fehler beim Test:", err);
  }
}

run();