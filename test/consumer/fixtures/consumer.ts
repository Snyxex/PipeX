import {
  DataEngine,
  definePlugin,
  BasePlugin,
  type PluginFactory,
  type ProcessorContext,
  Plugins,
  ValidationPlugin,
  type EngineResult,
  type ProcessorPlugin,
} from 'pipex';
import { KmsEncryptionPlugin } from 'pipex/plugins/kms';

const engine = new DataEngine();
const validationConstructor: typeof ValidationPlugin = Plugins.Validation;
const kmsConstructor: typeof KmsEncryptionPlugin = KmsEncryptionPlugin;
const plugins: readonly ProcessorPlugin[] = engine.plugins;
const result: EngineResult = await engine.binary.run({ id: 1 });
await engine.binary.undo(result);
void validationConstructor;
void kmsConstructor;
void plugins;

const createPrefix: PluginFactory<{ prefix: string }> = ({ prefix }) => definePlugin({
  name: 'consumer-prefix', version: '1.0.0',
  process(data, context) { void context.signal; return Buffer.concat([Buffer.from(prefix), data]); },
  reverse(data) { return data.subarray(Buffer.byteLength(prefix)); },
});
class TypedPlugin extends BasePlugin<{ prefix: string }> {
  readonly name = 'typed';
  readonly version = '1.0.0';
  process(data: Buffer, _context: ProcessorContext): Buffer {
    // @ts-expect-error Typed options reject unknown properties.
    void this.options.missing;
    return Buffer.concat([Buffer.from(this.options.prefix), data]);
  }
}
new DataEngine().use(createPrefix({ prefix: 'PX:' })).use(new TypedPlugin({ prefix: ':' }));
await DataEngine.fromConfig({ plugins: [{ name: 'prefix', options: { prefix: ':' } }] }, { prefix: createPrefix });
// @ts-expect-error Factories require their declared option type.
createPrefix({ prefix: 123 });
