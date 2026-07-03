import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataEngine, WorkerPoolPlugin } from '../src/index.js';

async function run() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pipex-file-'));
  const inputPath = path.join(tempDir, 'performance.txt');
  const outputPath = path.join(tempDir, 'performance.enc');
  const restoredPath = path.join(tempDir, 'performance.restored.txt');

  try {
    const engine = new DataEngine();
    engine.use(new WorkerPoolPlugin({ maxThreads: 4 }));

    writeFileSync(inputPath, 'This is a WorkerPool stream test file. '.repeat(1000));

    await engine.file.process(inputPath, outputPath);
    await engine.file.reverse(outputPath, restoredPath);

    if (!readFileSync(inputPath).equals(readFileSync(restoredPath))) {
      throw new Error('Restored file does not match input file');
    }

    console.log('File processing test passed.');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('File test failed:', err);
  process.exit(1);
});
