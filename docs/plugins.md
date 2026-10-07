# Writing PipeX plugins

Plugins transform Buffer values. Attach an instance with `engine.use(plugin)`.
No class or global registration is required. Objects and arrays passed to
`binary.run()` are MessagePack-encoded before plugins run; strings and Buffers
use their binary representation. `pack()`/`unpack()` do not execute plugins.

## A complete reversible plugin

```ts
import { DataEngine, definePlugin } from 'pipex';

export function createPrefixPlugin(options: { prefix: string }) {
  if (!options || typeof options.prefix !== 'string' || options.prefix.length === 0) {
    throw new TypeError('A nonempty prefix is required');
  }
  const prefix = Buffer.from(options.prefix, 'utf8');
  return definePlugin({
    name: 'example-prefix', version: '1.0.0',
    process(data, context) {
      context.signal?.throwIfAborted();
      if (context.limits && data.length + prefix.length > context.limits.maxOutputBytes) {
        throw new Error('Prefix output exceeds limit');
      }
      return Buffer.concat([prefix, data]);
    },
    reverse(data, context) {
      context.signal?.throwIfAborted();
      if (!data.subarray(0, prefix.length).equals(prefix)) throw new Error('Invalid prefix');
      return data.subarray(prefix.length);
    },
  });
}

const engine = new DataEngine().use(createPrefixPlugin({ prefix: 'PX:' }));
const result = await engine.binary.run({ id: 42 });
const restored = await engine.binary.undo(result);
// restored: { id: 42 }
```

Omit `reverse` for a forward-only plugin. PipeX rejects unsupported reverse
pipelines before invoking them. Reverse operations execute plugins in reverse
order. Received/reconstructed results require application-owned `expectedType`
as described in README.md.

`definePlugin` validates fields and capabilities immediately. It returns a
shallow frozen snapshot and copies `retryOptions`. Use closures for options
and mutable state rather than assigning fields through `this`. It does not
deeply freeze external objects or sandbox code. Create fresh plugin instances
per engine and make state safe for concurrent requests.

## Configuration without global registration

Pass a local factory registry as the second argument to `fromConfig`:

```ts
const configured = await DataEngine.fromConfig({
  plugins: [
    { name: 'prefix', options: { prefix: 'PX:' } },
    { name: 'compression', options: { type: 'gzip', level: 6 } },
  ],
}, { prefix: createPrefixPlugin });
```

Local factories override matching names only for this load. They do not change
other engines or global registrations. A factory receives configured options
and must synchronously return a valid `ProcessorPlugin`. Validate options in
your factory: config options are unknown input and TypeScript cannot validate
them at runtime. Factory failures abort startup with plugin context.

For application-wide registration:

```ts
DataEngine.registerPluginFactory('prefix', createPrefixPlugin);
const shared = await DataEngine.fromConfig({
  plugins: [{ name: 'prefix', options: { prefix: 'PX:' } }],
});
```

Registry names contain letters, digits and hyphens, begin with a letter or digit,
and have at most 64 characters. Explicit registration replaces existing names.
Register application-wide factories during startup. Prefer local registries
for reusable libraries and independent tenants to avoid shared global state.

## Streams are an explicit choice

`definePlugin` defaults to binary-only unless `createStream` is provided.
This prevents whole-message transforms being applied to arbitrary chunks.
File `process`/`reverse` also require streaming-capable plugins.

- Set `streaming: true` only if `process` and `reverse` are correct for every
  possible chunk boundary. PipeX uses its chunk fallback and bounded retries.
- Implement `createStream(mode, context)` for framing or stateful stream
  semantics. Return a fresh Node.js Duplex/Transform each time. Legacy mode
  names are `compress` (forward) and `decompress` (reverse). Respect
  backpressure, `context.signal` and `context.limits`. Native streams handle
  their own retry/failure behavior.
- Reverse streams also require a `reverse` method and a reversible capability.
  Inspect `engine.pluginCapabilities` or `getPluginCapabilities(plugin)`.

The prefix example is deliberately binary-only: removing a prefix independently
from receive chunks corrupts data. A native version needs specified framing,
not assumptions about transport chunk sizes. Existing `ProcessorPlugin` objects
and `BasePlugin` subclasses retain legacy fallback behavior; the safer default
applies to `definePlugin` only.

## Context, errors and retries

`ProcessorContext` supplies request ID, timestamp, metadata, optional signal/
limits, logger and span. `StreamPluginContext` supplies request ID, signal,
limits and observability hooks. Do not put secrets or raw payloads into errors
or logs. Metadata is per-call information, not persistent storage or an implicit
communication channel between forward and reverse requests.

Async methods may return `Promise<Buffer>`. Check cancellation before expensive
work and pass signals to I/O. Check limits before large allocations. Engine
bounds and deadlines remain active, but synchronous work cannot be preempted
and arbitrary in-process plugins are trusted application code.

Optional `retryOptions` use `attempts`, `backoff` (`fixed` or `exponential`) and
`delayMs`. Retries are capped by engine limits. Retryable work must be idempotent
or deduplicate its effects. Return a Buffer and throw on failure.

## Typed classes and separate packages

```ts
import { BasePlugin, type ProcessorContext } from 'pipex';
class PrefixPlugin extends BasePlugin<{ prefix: string }> {
  readonly name = 'class-prefix';
  readonly version = '1.0.0';
  readonly streaming = false;
  process(data: Buffer, _context: ProcessorContext): Buffer {
    return Buffer.concat([Buffer.from(this.options.prefix), data]);
  }
}
new DataEngine().use(new PrefixPlugin({ prefix: 'PX:' }));
DataEngine.registerPlugin('class-prefix', PrefixPlugin);
```

The class example is forward-only. Override `reverse` for reversibility and
choose streaming behavior explicitly when using legacy classes.

A separate plugin package can export its factory or BasePlugin subclass.
Declare `pipex` as a peer dependency with a tested version range and publish
ESM JavaScript plus TypeScript declarations. Applications explicitly import
and attach plugins or supply factories. PipeX never loads arbitrary module
paths from configuration.

Test binary roundtrips, forward-only rejection, cancellation, limits and malformed
inputs. For stream plugins, fragment input differently in each direction and
test truncation and backpressure. Also test fresh consumers importing public
`pipex` exports.
