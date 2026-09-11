import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ['./src/index.ts', './src/plugin/worker_piscina.ts'],
    platform: 'node',
    outDir: './dist',
    format: ['esm'],
    dts: {
      sourcemap: true,
     
    },
    sourcemap: true,
})
