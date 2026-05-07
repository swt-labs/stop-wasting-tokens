import { defineConfig } from 'tsup';

interface EsbuildPluginBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string; namespace: string },
  ): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: string },
  ): void;
}

const stubDevDeps = {
  name: 'stub-ink-devtools',
  setup(build: EsbuildPluginBuild): void {
    const filter = /^(react-devtools-core)$/;
    build.onResolve({ filter }, (args) => ({
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
