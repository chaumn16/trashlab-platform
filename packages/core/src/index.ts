export { CoreApp, CoreLayout } from "./app/index.js";
export { createStore, defaultSeed } from "./db/store.js";
export type { DataStore, SeedData } from "./db/store.js";
export { createRuntime } from "./domain/runtime.js";
export type { TenantRuntime, HookError } from "./domain/runtime.js";
export { defaultPricing } from "./domain/pricing.js";

/** Kept in sync with package.json by `npm version`; rendered in the shell and
 *  reported to the control plane on every deploy. */
export const CORE_VERSION = "4.2.3";
