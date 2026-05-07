import { defineConfig } from 'tsup';

const stubDevDeps = {
  name: 'stub-ink-devtools',
  setup(build: { onResolve: Function; onLoad: Function }): void {
    const filter = /^(react-devtools-core)$/;
    build.onResolve({ filter }, (args: { path: string }) => ({
      path: args.path,
      namespace: 'stubbed',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stubbed' }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
  },
};

export default defineConfig({
  entry: { cli: 'packages/cli/src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: { resolve: true },
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  platform: 'node',
  shims: true,
  esbuildPlugins: [stubDevDeps],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __swtCreateRequire } from 'module';
const require = __swtCreateRequire(import.meta.url);`,
  },
});
