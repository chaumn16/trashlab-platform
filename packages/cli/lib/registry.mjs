import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REGISTRY = join(ROOT, "registry", "tenants.json");

/**
 * In production this module is a thin HTTP client against the control-plane
 * API, and the registry is a Postgres table with an audit log on every write.
 * Backing it with a JSON file keeps the CLI runnable with no infrastructure
 * while the command surface stays identical.
 */

export const paths = { ROOT, REGISTRY, TEMPLATE: join(ROOT, "templates", "tenant-starter"), TENANTS: join(ROOT, "tenants") };

export function load() {
  return JSON.parse(readFileSync(REGISTRY, "utf8"));
}

export function save(data) {
  writeFileSync(REGISTRY, JSON.stringify(data, null, 2) + "\n");
}

export function getTenant(id) {
  const t = load().tenants.find((t) => t.id === id);
  if (!t) throw new Error(`No tenant "${id}" in the registry. Run: platform fleet status`);
  return t;
}

export function updateTenant(id, patch) {
  const data = load();
  const i = data.tenants.findIndex((t) => t.id === id);
  if (i === -1) throw new Error(`No tenant "${id}"`);
  data.tenants[i] = { ...data.tenants[i], ...patch };
  save(data);
  return data.tenants[i];
}

/** Semver compare, enough for release ordering (handles -rc.N prereleases). */
export function semverLt(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split("-");
    return [...core.split(".").map(Number), pre ? 0 : 1, pre ?? ""];
  };
  const [aM, am, ap, aStable, aPre] = parse(a);
  const [bM, bm, bp, bStable, bPre] = parse(b);
  if (aM !== bM) return aM < bM;
  if (am !== bm) return am < bm;
  if (ap !== bp) return ap < bp;
  if (aStable !== bStable) return aStable < bStable;
  return aPre < bPre;
}
