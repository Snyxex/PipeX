import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  BasePlugin,
  CompressionPlugin,
  DataEngine,
  InvalidPluginCapabilityError,
  UnsupportedReverseError,
  getPluginCapabilities,
  supportsOperation,
} from '../../dist/index.mjs';

class ForwardOnlyPlugin extends BasePlugin {
  name = 'forward-only';
  version = '1.0.0';
  process(data) { return data; }
}

test('capabilities expose supported operations without executing the plugin', () => {
  const forwardOnly = new ForwardOnlyPlugin();
  const compression = new CompressionPlugin({ type: 'gzip', level: 1 });

  assert.deepEqual(getPluginCapabilities(forwardOnly), {
    process: true,
    reverse: false,
    streaming: true,
    streamMode: 'fallback',
  });
  assert.deepEqual(getPluginCapabilities(compression), {
    process: true,
    reverse: true,
    streaming: true,
    streamMode: 'native',
  });
  assert.equal(supportsOperation(forwardOnly, 'process'), true);
  assert.equal(supportsOperation(forwardOnly, 'reverse'), false);
  assert.equal(supportsOperation(compression, 'reverse'), true);
  assert.throws(() => supportsOperation(compression, 'unknown'), /Unknown plugin operation/);
});

test('BasePlugin reverse is fail-closed and never includes input data in its error', () => {
  const plugin = new ForwardOnlyPlugin();
  const secret = Buffer.from('top-secret-payload');

  assert.throws(() => plugin.reverse(secret, {}), error => {
    assert.ok(error instanceof UnsupportedReverseError);
    assert.equal(error.code, 'UNSUPPORTED_REVERSE');
    assert.doesNotMatch(error.message, /top-secret-payload/);
    return true;
  });
});

test('engine exposes an immutable, normalized capability view', () => {
  const engine = new DataEngine().use(new ForwardOnlyPlugin());
  const capabilities = engine.pluginCapabilities;

  assert.deepEqual(capabilities, [{
    plugin: 'forward-only@1.0.0',
    process: true,
    reverse: false,
    streaming: true,
    streamMode: 'fallback',
  }]);
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(Object.isFrozen(capabilities[0]), true);
  assert.throws(() => capabilities.push({}), TypeError);
});

test('contradictory capability declarations fail during registration', () => {
  const cases = [
    {
      plugin: { name: 'missing-reverse', version: '1.0.0', reversible: true, process: data => data },
      capability: 'reversible',
      issue: 'MISSING_IMPLEMENTATION',
    },
    {
      plugin: {
        name: 'disabled-stream',
        version: '1.0.0',
        streaming: false,
        process: data => data,
        createStream: () => new PassThrough(),
      },
      capability: 'streaming',
      issue: 'CONFLICTING_IMPLEMENTATION',
    },
    {
      plugin: { name: 'invalid-flag', version: '1.0.0', reversible: 'yes', process: data => data },
      capability: 'reversible',
      issue: 'MUST_BE_BOOLEAN',
    },
  ];

  for (const { plugin, capability, issue } of cases) {
    assert.throws(() => new DataEngine().use(plugin), error => {
      assert.ok(error instanceof InvalidPluginCapabilityError);
      assert.equal(error.code, 'INVALID_PLUGIN_CAPABILITY');
      assert.equal(error.capability, capability);
      assert.equal(error.issue, issue);
      return true;
    });
  }
});

test('BasePlugin cannot claim reverse support without overriding reverse', () => {
  class MisdeclaredPlugin extends ForwardOnlyPlugin {
    reversible = true;
  }

  assert.throws(
    () => new DataEngine().use(new MisdeclaredPlugin()),
    InvalidPluginCapabilityError,
  );
});

test('capability queries detect implementation drift after registration', () => {
  const plugin = {
    name: 'mutable-plugin',
    version: '1.0.0',
    reversible: true,
    process: data => data,
    reverse: data => data,
  };
  const engine = new DataEngine().use(plugin);
  assert.equal(engine.pluginCapabilities[0].reverse, true);

  plugin.reverse = undefined;
  assert.throws(() => engine.pluginCapabilities, InvalidPluginCapabilityError);
  assert.throws(() => supportsOperation(plugin, 'reverse'), InvalidPluginCapabilityError);
});

test('explicitly disabled reverse remains valid for conditional implementations', async () => {
  const plugin = {
    name: 'conditional',
    version: '1.0.0',
    reversible: false,
    process: data => data,
    reverse() { throw new UnsupportedReverseError('conditional@1.0.0'); },
  };
  const engine = new DataEngine().use(plugin);

  assert.equal(engine.pluginCapabilities[0].reverse, false);
  const result = await engine.binary.run(Buffer.from('secret-data'));
  await assert.rejects(engine.binary.undo(result), error => {
    assert.ok(error instanceof UnsupportedReverseError);
    assert.doesNotMatch(error.message, /secret-data/);
    return true;
  });
});
