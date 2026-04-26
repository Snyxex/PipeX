import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ['./src/index.ts'],
    platform: 'node',
    outDir: './dist',
    format: ['esm'],
    /*dts: {
      sourcemap: true,
     
    },*/
    sourcemap: true,
    unused: true,
})