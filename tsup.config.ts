import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['packages/cli/src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
