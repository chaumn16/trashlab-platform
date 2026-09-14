/**
 * @trashlab/core — framework-free entry point.
 *
 * Deliberately does NOT re-export the React/Next surface. `./app` imports
 * next/navigation, which only a bundler can resolve; re-exporting it here made
 * `import "@trashlab/core"` fail under plain Node — breaking the migrate CLI,
 * scripts, and any test that touches the store.
 *
 * Everything exported here runs anywhere. UI lives at "@trashlab/core/app".
 */
export { createStore, defaultSeed } from "./db/store.js";
export type { DataStore, SeedData } from "./db/store.js";
export { createRuntime } from "./domain/runtime.js";
export type { TenantRuntime, HookError } from "./domain/runtime.js";
export { defaultPricing } from "./domain/pricing.js";

/** Kept in sync with package.json by `npm version`; rendered in the shell and
 *  reported to the control plane on every deploy. */
export const CORE_VERSION = "4.2.3";
