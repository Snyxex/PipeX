import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable, Transform } from 'node:stream';
import { DataEngine, definePlugin, BasePlugin, UnsupportedStreamingError, UnsupportedReverseError } from 'pipex';

const prefix = (options = {}) => {
  if (typeof options.prefix !== 'string' || options.prefix.length === 0) throw new Error('prefix is required');
  const bytes = Buffer.from(options.prefix);
  return definePlugin({
    name: 'custom-prefix', version: '1.0.0',
    process(data) { return Buffer.concat([bytes, data]); },
    reverse(data) {
      if (!data.subarray(0, bytes.length).equals(bytes)) throw new Error('invalid prefix');
      return data.subarray(bytes.length);
    },
  });
};

const collect = () => {
  const chunks = [];
  return { chunks, output: new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }) };
};

test('object plugins roundtrip with built-ins and snapshot their declaration', async () => {
  const declaration = { name: 'identity', version: '1.0.0', process: data => data, reverse: data => data };
  const plugin = definePlugin(declaration);
  declaration.process = () => { throw new Error('changed'); };
  declaration.name = 'changed';
  assert.ok(Object.isFrozen(plugin));
  const engine = await DataEngine.fromConfig({ plugins: [{ name: 'compression', options: { type: 'gzip' } }] });
  engine.use(prefix({ prefix: 'PX:' })).use(plugin);
  const input = { id: 42, items: ['a', 'b'] };
  assert.deepEqual(await engine.binary.undo(await engine.binary.run(input)), input);
  assert.deepEqual(engine.pipeline, ['compression@3.0.0', 'custom-prefix@1.0.0', 'identity@1.0.0']);
});

test('safe defaults reject reverse and streams before running a binary-only plugin', async () => {
  let calls = 0;
  const engine = new DataEngine().use(definePlugin({ name: 'forward', version: '1', process(data) { calls++; return data; } }));
  const result = await engine.binary.run(Buffer.from('hello'));
  await assert.rejects(engine.binary.undo(result), UnsupportedReverseError);
  const target = collect();
  await assert.rejects(engine.stream.pipe(Readable.from([Buffer.from('hello')]), target.output), UnsupportedStreamingError);
  assert.equal(calls, 1);
  assert.equal(engine.pluginCapabilities[0].streamMode, 'none');
});

test('explicit chunk-independent fallback and native streams work through the public API', async () => {
  const xor = data => Buffer.from(data.map(byte => byte ^ 0x5a));
  for (const native of [false, true]) {
    const engine = new DataEngine().use(definePlugin({
      name: 'xor-example', version: '1', process: xor, reverse: xor,
      ...(native ? { createStream(_mode, context) {
        assert.ok(context.signal);
        return new Transform({ transform(chunk, _encoding, callback) { callback(null, xor(chunk)); } });
      } } : { streaming: true }),
    }));
    const encoded = collect();
    await engine.stream.pipe(Readable.from([Buffer.from('ab'), Buffer.from('cdef')]), encoded.output);
    const decoded = collect();
    const bytes = Buffer.concat(encoded.chunks);
    await engine.stream.pipe(Readable.from(Array.from(bytes, byte => Buffer.from([byte]))), decoded.output, true);
    assert.equal(Buffer.concat(decoded.chunks).toString(), 'abcdef');
    assert.equal(engine.pluginCapabilities[0].streamMode, native ? 'native' : 'fallback');
  }
});

test('configuration-local factories override names without changing global registrations', async () => {
  DataEngine.registerPluginFactory('authoring-prefix', prefix);
  const config = { plugins: [{ name: 'authoring-prefix', options: { prefix: 'GLOBAL:' } }] };
  const local = await DataEngine.fromConfig(config, { 'authoring-prefix': () => prefix({ prefix: 'LOCAL:' }) });
  const global = await DataEngine.fromConfig(config);
  assert.equal((await local.binary.run('x')).data.toString(), 'LOCAL:x');
  assert.equal((await global.binary.run('x')).data.toString(), 'GLOBAL:x');
  const isolated = await DataEngine.fromConfig({ plugins: [{ name: 'local-only', options: { prefix: 'ONLY:' } }] }, { 'local-only': prefix });
  assert.equal((await isolated.binary.run('x')).data.toString(), 'ONLY:x');
  await assert.rejects(DataEngine.fromConfig({ plugins: [{ name: 'local-only' }] }), /Unknown plugin/);
});

test('invalid definitions, factory registries and factory outputs fail at setup', async () => {
  for (const definition of [null, {}, { name: 'bad', version: '1', process: true },
    { name: 'bad', version: '1', process: data => data, reverse: true },
    { name: 'bad', version: '1', process: data => data, createStream: true },
    { name: 'bad', version: '1', process: data => data, reversible: true },
    { name: 'bad', version: '1', process: data => data, streaming: null },
    { name: 'bad', version: '1', process: data => data, streaming: false, createStream: () => new Transform() }]) {
    assert.throws(() => definePlugin(definition));
  }
  assert.throws(() => DataEngine.registerPluginFactory('bad/name', prefix));
  for (const registry of [null, [], { invalid: 42 }]) await assert.rejects(DataEngine.fromConfig({}, registry));
  await assert.rejects(DataEngine.fromConfig({ plugins: [null] }), /Invalid plugin configuration/);
  await assert.rejects(DataEngine.fromConfig({ plugins: [{ name: 'bad' }] }, { bad: () => ({}) }), /Failed to initialize/);
  await assert.rejects(DataEngine.fromConfig({ plugins: [{ name: 'bad' }] }, { bad: async () => prefix({ prefix: 'x' }) }), /Failed to initialize/);
  await assert.rejects(DataEngine.fromConfig({ plugins: [{ name: 'prefix' }] }, { prefix }), /prefix is required/);
});

test('legacy class registration and active-operation mutation protection stay compatible', async () => {
  class Legacy extends BasePlugin {
    name = 'legacy'; version = '1';
    process(data) { return Buffer.concat([Buffer.from(this.options.prefix), data]); }
    reverse(data) { return data.subarray(this.options.prefix.length); }
  }
  DataEngine.registerPlugin('authoring-legacy', Legacy);
  const engine = await DataEngine.fromConfig({ plugins: [{ name: 'authoring-legacy', options: { prefix: ':' } }] });
  assert.equal(await engine.binary.undo(await engine.binary.run('hello')), 'hello');
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  engine.use(definePlugin({ name: 'waiting', version: '1', async process(data) { await waiting; return data; } }));
  const operation = engine.binary.run('hello');
  assert.throws(() => engine.use(prefix({ prefix: 'late:' })), /operations are active/);
  release();
  await operation;
});
