/**
 * `@swt-labs/shared` — the leaf package of the v3 dependency graph.
 *
 * Per §4.3 architecture: every layer above L0 (runtime adapter) and L1 (core
 * abstractions) imports from here for canonical types and Zod schemas.
 * Shared itself has zero internal workspace deps; its only external runtime
 * deps are zod (and typebox for Pi-tool params, when those land).
 */

export * from './types/index.js';
export * from './schemas/index.js';

export const PACKAGE_NAME = '@swt-labs/shared';
