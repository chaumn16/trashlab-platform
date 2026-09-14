import registryData from "../../../registry/tenants.json";

/**
 * The tenant registry — source of truth for the fleet.
 *
 * ┌─ SWAP POINT ───────────────────────────────────────────────────────────┐
 * │ Reads are served from the registry JSON, bundled at build time.         │
 * │                                                                         │
 * │ WRITES DO NOT PERSIST. Vercel's filesystem is read-only at runtime, so  │
 * │ the callback endpoints below record into an in-process cache that is    │
 * │ lost on every cold start and is NOT shared between serverless instances.│
 * │ That is fine for a demo and wrong for production.                        │
 * │                                                                         │
 * │ For production, replace readTenants/recordEvent with Vercel Postgres,   │
 * │ Neon, or KV. The interface and every caller stay identical. Nothing     │
 * │ else in this app needs to change.                                       │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export interface Tenant {
  id: string;
  displayName: string;
  tier: string;
  channel: string;
  coreVersion: string;
  vercelProject: string;
  domain: string;
  database: string;
  region: string;
  repo: string;
  plan: string;
  hasCustomCode: boolean;
  createdAt: string;
  lastDeploy: string | null;
  health: string;
  pinExpiry?: string;
  pinReason?: string;
}

export interface Channels {
  canary: string;
  beta: string;
  stable: string;
}

export interface FleetEvent {
  kind: "ci" | "deploy";
  tenantId: string;
  status: string;
  sha?: string;
  pr?: string;
  url?: string;
  at: string;
}

const data = registryData as unknown as { coreChannels: Channels; tenants: Tenant[] };

/**
 * Ephemeral. See SWAP POINT above.
 *
 * Stashed on globalThis because Next re-evaluates modules on hot reload and
 * renders server actions in a separate module graph from pages — without this,
 * an event posted by an action is invisible to the page that follows it. This
 * fixes module re-instantiation ONLY. It does nothing for the real problem:
 * separate serverless instances in production do not share memory, which is why
 * the swap point above is not optional.
 */
const globalStore = globalThis as unknown as { __events?: FleetEvent[] };
const events: FleetEvent[] = (globalStore.__events ??= []);

export function readTenants(): Tenant[] {
  return data.tenants;
}

export function readChannels(): Channels {
  return data.coreChannels;
}

export function recordEvent(e: FleetEvent): void {
  events.unshift(e);
  events.length = Math.min(events.length, 50);
}

export function readEvents(): FleetEvent[] {
  return events;
}

/** Semver compare, enough for release ordering (handles -rc.N prereleases). */
export function semverLt(a: string, b: string): boolean {
  const parse = (v: string): [number, number, number, number, string] => {
    const [core, pre] = v.split("-");
    const [maj, min, pat] = core.split(".").map(Number);
    return [maj, min, pat, pre ? 0 : 1, pre ?? ""];
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 4; i++) {
    if (A[i] !== B[i]) return (A[i] as number) < (B[i] as number);
  }
  return A[4] < B[4];
}
