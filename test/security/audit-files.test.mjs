import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, link } from 'node:fs/promises';
import { renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { DataEngine } from '../../dist/index.mjs';

test('file handles prevent a post-validation directory swap from redirecting input or output', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pipex-handle-race-'));
  const root = join(base, 'root');
  const directory = join(root, 'data');
  const outside = join(base, 'outside');
  const moved = join(root, 'original');
  await mkdir(directory, { recursive: true });
  await mkdir(outside);
  await writeFile(join(directory, 'input'), 'inside payload');
  await writeFile(join(outside, 'input'), 'outside-secret');
  await writeFile(join(outside, 'output'), 'outside-sentinel');
  let swapError;
  let swapped = false;
  const engine = new DataEngine().use({
    name: 'race', version: '1', process(data) { return data; }, reverse(data) { return data; },
    createStream() {
      try {
        renameSync(directory, moved);
        symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
        swapped = true;
      } catch (error) { swapError = error; }
      return new PassThrough();
    },
  });
  try {
    await engine.file.process(join(directory, 'input'), join(directory, 'output'), root);
    assert.equal(await readFile(join(outside, 'output'), 'utf8'), 'outside-sentinel');
    const actualDirectory = swapped ? moved : directory;
    assert.equal(await readFile(join(actualDirectory, 'output'), 'utf8'), 'inside payload');
    assert.deepEqual((await readdir(actualDirectory)).sort(), ['input', 'output']);
    if (process.platform === 'win32') { assert.equal(swapped, false); assert.ok(swapError); }
    else assert.equal(swapped, true);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('file sessions reject hard-link input aliases without modifying either name', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pipex-handle-alias-'));
  try {
    const input = join(base, 'input');
    const alias = join(base, 'alias');
    await writeFile(input, 'original');
    await link(input, alias);
    const engine = new DataEngine({ maxConcurrentOperations: 1 });
    await assert.rejects(engine.file.process(input, alias, base), /different files/);
    assert.equal(await readFile(input, 'utf8'), 'original');
    await engine.file.process(input, join(base, 'safe'), base);
    assert.equal(await readFile(join(base, 'safe'), 'utf8'), 'original');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('file setup and plugin failures remove temporary state and preserve existing destinations', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pipex-handle-cleanup-'));
  try {
    const input = join(base, 'input');
    const output = join(base, 'output');
    await writeFile(input, 'original');
    await writeFile(output, 'keep');
    const engine = new DataEngine({ maxConcurrentOperations: 1 }).use({
      name: 'failure', version: '1', process() { throw new Error('plugin failure'); },
    });
    await assert.rejects(engine.file.process(input, output, base), /plugin failure/);
    assert.equal(await readFile(output, 'utf8'), 'keep');
    assert.deepEqual((await readdir(base)).sort(), ['input', 'output']);
    // Proves handles were released after failure; Windows disallows removal
    // of the input or directory while the session's handles remain open.
    await rm(input);
  } finally { await rm(base, { recursive: true, force: true }); }
});


test('file cancellation closes handles while retaining capacity for non-cooperative plugin work', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pipex-handle-abort-'));
  try {
    const input = join(base, 'input');
    const output = join(base, 'output');
    await writeFile(input, 'original');
    await writeFile(output, 'keep');
    let finish;
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const engine = new DataEngine({ maxConcurrentOperations: 1 }).use({
      name: 'deferred', version: '1', process(data) {
        return new Promise(resolve => { finish = () => resolve(data); entered(); });
      },
    });
    const controller = new AbortController();
    const operation = engine.file.process(input, output, base, { signal: controller.signal, timeoutMs: 0 });
    await ready;
    controller.abort();
    await assert.rejects(operation, /abort/i);
    assert.equal(await readFile(output, 'utf8'), 'keep');
    assert.deepEqual((await readdir(base)).sort(), ['input', 'output']);
    assert.throws(() => engine.use({ name: 'next', version: '1', process(data) { return data; } }), /operations are active/);
    finish();
    await new Promise(resolve => setImmediate(resolve));
    engine.use({ name: 'next', version: '1', process(data) { return data; } });
    await rm(input);
  } finally { await rm(base, { recursive: true, force: true }); }
});
