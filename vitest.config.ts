import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // alpha.23 — suppress the LLM-trace writer in spawn-orchestrator-session
    // so unit tests that exercise the dispatch path don't smear stderr with
    // `[llm turn N]` / `[tool]` lines. Production runs keep tracing on by
    // default; integration tests that explicitly assert trace shape inject
    // `traceWriter` via opts.
    env: {
      SWT_NO_LLM_TRACE: '1',
    },
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts', '**/types/**'],
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
        statements: 60,
      },
    },
  },
});
