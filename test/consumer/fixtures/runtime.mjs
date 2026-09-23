import assert from 'node:assert/strict';
import { DataEngine, Plugins, ValidationPlugin } from 'pipex';
import { KmsEncryptionPlugin } from 'pipex/plugins/kms';

assert.equal(Plugins.Validation, ValidationPlugin);
assert.equal(typeof KmsEncryptionPlugin, 'function');
const schema = { safeParse(value) { return { success: value?.id === 1 }; } };
const engine = new DataEngine().use(new ValidationPlugin({ schema }));
const result = await engine.binary.run({ id: 1 });
assert.deepEqual(await engine.binary.undo(result), { id: 1 });
console.log('pipex consumer runtime ok');
