import registryData from "../../../registry/tenants.json";
import {
  migrateControlPlane, seedControlPlane, readTenantsDb, readChannelsDb,
  recordEventDb, readEventsDb, type Queryable,
} from "./db";

/**
 * The tenant registry — source of truth for the fleet.
 *
 * Two backends, chosen by DATABASE_URL:
 *
 *   set    → Postgres. Durable, shared across serverless instances. Production.
 *   unset  → the bundled registry JSON for reads, an in-process array for
 *            writes. Local development, no database required.
 *
 * The in-memory path is not a half-finished version of the Postgres one — it is
 * how the app runs on a laptop with nothing installed. Both are real.
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
 * Lazily connect, and migrate + seed on first use.
 *
 * Seeding from the bundled JSON means a fresh control-plane database comes up
 * already knowing the fleet, so the first deploy is not an empty dashboard.
 */
let pooling: Promise<Queryable | null> | null = null;

function db(): Promise<Queryable | null> {
  if (pooling) return pooling;
  const url = process.env.DATABASE_URL;
  if (!url) {
    pooling = Promise.resolve(null);
    return pooling;
  }
  pooling = (async () => {
    const { Pool } = await import("pg");
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
    const pool = new Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 3,
    }) as unknown as Queryable;
    await migrateControlPlane(pool);
    await seedControlPlane(pool, data);
    return pool;
  })();
  return pooling;
}

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

export async function readTenants(): Promise<Tenant[]> {
  const conn = await db();
  return conn ? readTenantsDb(conn) : data.tenants;
}

export async function readChannels(): Promise<Channels> {
  const conn = await db();
  return conn ? readChannelsDb(conn) : data.coreChannels;
}

export async function recordEvent(e: FleetEvent): Promise<void> {
  const conn = await db();
  if (conn) {
    await recordEventDb(conn, e);
    return;
  }
  events.unshift(e);
  events.length = Math.min(events.length, 50);
}

export async function readEvents(): Promise<FleetEvent[]> {
  const conn = await db();
  return conn ? readEventsDb(conn) : events;
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
