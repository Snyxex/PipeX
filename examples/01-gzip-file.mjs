/** Compress and restore a real file using the atomic file controller. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataEngine, CompressionPlugin } from '../dist/index.mjs';

const root = await mkdtemp(join(tmpdir(), 'pipex-gzip-'));
try {
  const input = join(root, 'input.txt');
  const compressed = join(root, 'input.px');
  const restored = join(root, 'restored.txt');
  await writeFile(input, 'PipeX gzip file example. '.repeat(1000));
  const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip', level: 6 }));
  await engine.file.process(input, compressed, root);
  await engine.file.reverse(compressed, restored, root);
  assert.deepEqual(await readFile(restored), await readFile(input));
  console.log('gzip file round-trip OK');
} finally {
  await rm(root, { recursive: true, force: true });
}
