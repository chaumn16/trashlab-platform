import type { Tenant, Channels, FleetEvent } from "./registry";
import type { ProvisionRequest } from "./provision";

/**
 * Postgres-backed control-plane storage.
 *
 * The control plane has its OWN database, separate from every tenant's. It holds
 * the fleet registry, deploy/CI events, and provisioning requests — data about
 * tenants, never data belonging to them.
 *
 * Written against a minimal `Queryable` so the same code runs on node-postgres
 * in production and PGlite in tests.
 */

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** One statement per entry — a multi-statement string only executes on the
 *  simple query protocol, which not every driver uses. */
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS channels (
     name    text PRIMARY KEY,
     version text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tenants (
     id              text PRIMARY KEY,
     display_name    text NOT NULL,
     tier            text NOT NULL DEFAULT 'dedicated',
     channel         text NOT NULL DEFAULT 'stable',
     core_version    text NOT NULL,
     vercel_project  text NOT NULL,
     domain          text NOT NULL,
     database        text NOT NULL,
     region          text NOT NULL,
     repo            text NOT NULL,
     plan            text NOT NULL,
     has_custom_code boolean NOT NULL DEFAULT false,
     health          text NOT NULL DEFAULT 'provisioning',
     pin_expiry      timestamptz,
     pin_reason      text,
     last_deploy     timestamptz,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS fleet_events (
     id         bigserial PRIMARY KEY,
     kind       text NOT NULL,
     tenant_id  text NOT NULL,
     status     text NOT NULL,
     sha        text,
     pr         text,
     url        text,
     at         timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS provision_requests (
     slug         text PRIMARY KEY,
     display_name text NOT NULL,
     plan         text NOT NULL,
     region       text NOT NULL,
     requested_by text NOT NULL,
     status       text NOT NULL,
     detail       text,
     at           timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS fleet_events_at_idx ON fleet_events (at DESC)`,
  `CREATE INDEX IF NOT EXISTS fleet_events_tenant_idx ON fleet_events (tenant_id)`,
];

export async function migrateControlPlane(db: Queryable): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}

/** Load the bundled JSON registry into an empty database. Idempotent. */
export async function seedControlPlane(
  db: Queryable,
  data: { coreChannels: Channels; tenants: Tenant[] }
): Promise<void> {
  for (const [name, version] of Object.entries(data.coreChannels)) {
    await db.query(
      `INSERT INTO channels (name, version) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version`,
      [name, version]
    );
  }
  for (const t of data.tenants) await upsertTenant(db, t);
}

/**
 * Write a tenant row, updating every field on conflict.
 *
 * Identity fields — domain, vercel_project, repo, database, region — are
 * updated, not just the volatile ones. registry/tenants.json is the source of
 * truth for who a tenant *is*: the provisioning workflow commits to it, so a
 * change there must reach the database. Leaving these out of the update meant a
 * row written once kept its original domain forever, and the dashboard went on
 * linking to hostnames that had been renamed in the repo.
 *
 * Volatile state the control plane owns — CI and deploy events, provisioning
 * requests — lives in its own tables and is never touched by seeding.
 */
export async function upsertTenant(db: Queryable, t: Tenant): Promise<void> {
  await db.query(
    `INSERT INTO tenants (id, display_name, tier, channel, core_version, vercel_project,
                          domain, database, region, repo, plan, has_custom_code, health,
                          pin_expiry, pin_reason, last_deploy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       tier = EXCLUDED.tier,
       channel = EXCLUDED.channel,
       core_version = EXCLUDED.core_version,
       vercel_project = EXCLUDED.vercel_project,
       domain = EXCLUDED.domain,
       database = EXCLUDED.database,
       region = EXCLUDED.region,
       repo = EXCLUDED.repo,
       plan = EXCLUDED.plan,
       has_custom_code = EXCLUDED.has_custom_code,
       health = EXCLUDED.health,
       pin_expiry = EXCLUDED.pin_expiry,
       pin_reason = EXCLUDED.pin_reason,
       last_deploy = EXCLUDED.last_deploy`,
    [t.id, t.displayName, t.tier, t.channel, t.coreVersion, t.vercelProject, t.domain,
     t.database, t.region, t.repo, t.plan, t.hasCustomCode, t.health,
     t.pinExpiry ?? null, t.pinReason ?? null, t.lastDeploy ?? null]
  );
}

export async function readTenantsDb(db: Queryable): Promise<Tenant[]> {
  const { rows } = await db.query(`SELECT * FROM tenants ORDER BY id`);
  return rows.map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    tier: r.tier as string,
    channel: r.channel as string,
    coreVersion: r.core_version as string,
    vercelProject: r.vercel_project as string,
    domain: r.domain as string,
    database: r.database as string,
    region: r.region as string,
    repo: r.repo as string,
    plan: r.plan as string,
    hasCustomCode: Boolean(r.has_custom_code),
    health: r.health as string,
    createdAt: iso(r.created_at) ?? "",
    lastDeploy: iso(r.last_deploy),
    pinExpiry: iso(r.pin_expiry) ?? undefined,
    pinReason: (r.pin_reason as string) ?? undefined,
  }));
}

export async function readChannelsDb(db: Queryable): Promise<Channels> {
  const { rows } = await db.query(`SELECT name, version FROM channels`);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.name as string] = r.version as string;
  return { canary: out.canary ?? "", beta: out.beta ?? "", stable: out.stable ?? "" };
}

export async function recordEventDb(db: Queryable, e: FleetEvent): Promise<void> {
  await db.query(
    `INSERT INTO fleet_events (kind, tenant_id, status, sha, pr, url, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.kind, e.tenantId, e.status, e.sha ?? null, e.pr ?? null, e.url ?? null, e.at]
  );
}

export async function readEventsDb(db: Queryable, limit = 25): Promise<FleetEvent[]> {
  const { rows } = await db.query(
    `SELECT kind, tenant_id, status, sha, pr, url, at FROM fleet_events ORDER BY at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    kind: r.kind as FleetEvent["kind"],
    tenantId: r.tenant_id as string,
    status: r.status as string,
    sha: (r.sha as string) ?? undefined,
    pr: (r.pr as string) ?? undefined,
    url: (r.url as string) ?? undefined,
    at: iso(r.at) ?? "",
  }));
}

export async function recordRequestDb(db: Queryable, r: ProvisionRequest): Promise<void> {
  await db.query(
    `INSERT INTO provision_requests (slug, display_name, plan, region, requested_by, status, detail, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (slug) DO UPDATE SET
       status = EXCLUDED.status, detail = EXCLUDED.detail, at = EXCLUDED.at`,
    [r.slug, r.displayName, r.plan, r.region, r.requestedBy, r.status, r.detail ?? null, r.at]
  );
}

export async function readRequestsDb(db: Queryable, limit = 25): Promise<ProvisionRequest[]> {
  const { rows } = await db.query(
    `SELECT * FROM provision_requests ORDER BY at DESC LIMIT $1`, [limit]
  );
  return rows.map((r) => ({
    slug: r.slug as string,
    displayName: r.display_name as string,
    plan: r.plan as string,
    region: r.region as string,
    requestedBy: r.requested_by as string,
    status: r.status as ProvisionRequest["status"],
    detail: (r.detail as string) ?? undefined,
    at: iso(r.at) ?? "",
  }));
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}
