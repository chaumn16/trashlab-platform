import * as m0001 from "./0001_core_schema.js";

/**
 * Applied in array order. Append only — never reorder or edit a shipped entry;
 * a migration that has run on any tenant database is immutable history.
 */
export const MIGRATIONS: Array<{ id: string; statements: string[] }> = [m0001];
