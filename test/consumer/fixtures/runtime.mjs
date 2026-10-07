import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataEngine, Plugins, ValidationPlugin } from 'pipex';
import { KmsEncryptionPlugin } from 'pipex/plugins/kms';

assert.equal(Plugins.Validation, ValidationPlugin);
assert.equal(typeof KmsEncryptionPlugin, 'function');
const schema = { safeParse(value) { return { success: value?.id === 1 }; } };
const engine = new DataEngine().use(new ValidationPlugin({ schema }));
const result = await engine.binary.run({ id: 1 });
assert.deepEqual(await engine.binary.undo(result), { id: 1 });
assert.deepEqual(await engine.binary.undo({ ...result, data: Buffer.from(result.data) }, { expectedType: 'object' }), { id: 1 });
const fileRoot = await mkdtemp(join(tmpdir(), 'pipex-consumer-files-'));
try {
  const input = join(fileRoot, 'input');
  const output = join(fileRoot, 'output');
  await writeFile(input, 'native file consumer');
  await new DataEngine().file.process(input, output, fileRoot);
  assert.equal(await readFile(output, 'utf8'), 'native file consumer');
} finally { await rm(fileRoot, { recursive: true, force: true }); }
console.log('pipex consumer runtime ok');
