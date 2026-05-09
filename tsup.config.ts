import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

// Source-of-truth: read the published version from package.json at build time
// and inject it as a global identifier via esbuild's `define`. The CLI's
// `swt --version` reads this constant; without injection, the source has a
// fallback of '0.0.0-dev' so test runs (vitest, tsx) get a sensible value
// without touching the bundle path.
const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

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
  entry: {
    cli: 'packages/cli/src/index.ts',
    'dashboard-server': 'packages/dashboard/src/server/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  // Only emit .d.ts for the CLI entry. The dashboard-server bundle is an
  // executable, not a typed import surface — and tsup's rollup-dts pass
  // chokes on `@hono/node-server`'s re-exports of `node:http` types,
  // which rollup-dts can't resolve. Skipping dts for it is safe.
  dts: { resolve: true, entry: { cli: 'packages/cli/src/index.ts' } },
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  platform: 'node',
  shims: true,
  esbuildPlugins: [stubDevDeps],
  define: {
    __SWT_VERSION__: JSON.stringify(pkg.version),
  },
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __swtCreateRequire } from 'module';
const require = __swtCreateRequire(import.meta.url);`,
  },
});
