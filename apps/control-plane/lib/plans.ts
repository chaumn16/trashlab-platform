/**
 * Client-safe constants.
 *
 * Deliberately a separate module from lib/provision.ts. The Add-tenant form is a
 * client component, and importing these from provision.ts dragged its server
 * dependencies — `pg`, and therefore `fs` — into the browser bundle, which fails
 * the build with "Module not found: Can't resolve 'fs'".
 *
 * Nothing in this file may import anything that touches the database.
 */
export const PLANS = ["starter", "growth", "enterprise"] as const;
export const REGIONS = ["iad1", "sfo1", "fra1", "syd1"] as const;

export type Plan = (typeof PLANS)[number];
export type Region = (typeof REGIONS)[number];
