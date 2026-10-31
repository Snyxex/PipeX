import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    compression: './src/entries/compression.ts',
    encryption: './src/entries/encryption.ts',
    hashing: './src/entries/hashing.ts',
    validation: './src/entries/validation.ts',
    parallel: './src/entries/parallel.ts',
    native: './src/entries/native.ts',
    kms: './src/entries/kms.ts',
  },
  platform: 'node',
  outDir: './dist',
  format: ['esm', 'cjs'],
  dts: true,
  // Keep runtime bundles and both declaration formats, but omit large dev-only maps.
  sourcemap: false,
  clean: true,
});
