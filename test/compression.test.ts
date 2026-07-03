import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataEngine, CompressionPlugin } from '../src/index.js';

async function runTest() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pipex-compression-'));
  const originalFile = path.join(tempDir, 'original.txt');
  const compressedFile = path.join(tempDir, 'compressed.pipex');
  const restoredFile = path.join(tempDir, 'restored.txt');

  try {
    const engine = new DataEngine();
    engine.use(new CompressionPlugin({ type: 'brotli', level: 5 }));

    const dummyContent = 'PipeX is fast. '.repeat(5000);
    writeFileSync(originalFile, dummyContent);

    await engine.file.process(originalFile, compressedFile);
    await engine.file.reverse(compressedFile, restoredFile);

    const original = readFileSync(originalFile, 'utf-8');
    const restored = readFileSync(restoredFile, 'utf-8');
    if (original !== restored) {
      throw new Error('Restored file differs from original file');
    }

    const oldSize = readFileSync(originalFile).length;
    const newSize = readFileSync(compressedFile).length;
    console.log(`Compression test passed: ${oldSize} bytes -> ${newSize} bytes`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

runTest().catch((err) => {
  console.error('Compression test failed:', err);
  process.exit(1);
});
