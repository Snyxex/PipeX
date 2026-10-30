import assert from 'node:assert/strict';
import { DataEngine, KmsEncryptionPlugin } from '@snyxex/pipex';
import { KmsEncryptionPlugin as KmsSubpathPlugin } from '@snyxex/pipex/plugins/kms';

// Check the public ESM imports after a clean `npm install github:...`.
// The subpath must remain usable by downstream clients.
assert.equal(typeof DataEngine, 'function');
assert.equal(typeof KmsEncryptionPlugin, 'function');
assert.equal(KmsSubpathPlugin, KmsEncryptionPlugin);
