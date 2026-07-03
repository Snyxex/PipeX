import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    worker_piscina: './src/plugin/worker_piscina.ts',
  },
  platform: 'node',
  outDir: './dist',
  format: ['esm'],
  dts: {
    sourcemap: true,
  },
  sourcemap: true,
});
