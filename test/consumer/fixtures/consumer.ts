import {
  DataEngine,
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
