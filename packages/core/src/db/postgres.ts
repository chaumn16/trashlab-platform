import type { Customer, Site, Job, JobStatus } from "../extend/types.js";
import type { DataStore, SeedData } from "./store.js";
import { MIGRATIONS } from "./migrations/index.js";
export { pgPoolConfig, caFromEnv, type PgPoolConfig } from "./connect.js";

/**
 * Postgres-backed data access.
 *
 * Each tenant has its own database, so nothing here is scoped by a tenant
 * column — isolation comes from the connection string, which lives in that
 * tenant's own Vercel project. Cross-tenant leakage is structurally impossible
 * rather than a code-review responsibility.
 *
 * Deliberately written against a minimal `Queryable` rather than `pg.Pool`, so
 * the same code runs against node-postgres in production and PGlite in tests.
 * Core takes no hard dependency on a driver — the tenant app supplies one.
 */

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function createPostgresStore(db: Queryable): DataStore {
  return {
    async getCustomer(id) {
      const { rows } = await db.query(`SELECT * FROM customers WHERE id = $1`, [id]);
      return rows[0] ? toCustomer(rows[0]) : null;
    },

    async getSite(id) {
      const { rows } = await db.query(`SELECT * FROM sites WHERE id = $1`, [id]);
      return rows[0] ? toSite(rows[0]) : null;
    },

    async listJobs(filter) {
      // Built positionally rather than by interpolation — these values reach the
      // database as parameters, never as SQL text.
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter?.customerId) {
        params.push(filter.customerId);
        where.push(`customer_id = $${params.length}`);
      }
      if (filter?.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const { rows } = await db.query(`SELECT * FROM jobs ${clause} ORDER BY scheduled_for`, params);
      return rows.map(toJob);
    },

    async listCustomers() {
      const { rows } = await db.query(`SELECT * FROM customers ORDER BY name`);
      return rows.map(toCustomer);
    },

    async listSites() {
      const { rows } = await db.query(`SELECT * FROM sites ORDER BY address`);
      return rows.map(toSite);
    },

    async getJob(id) {
      const { rows } = await db.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
      return rows[0] ? toJob(rows[0]) : null;
    },

    async saveJob(job) {
      await db.query(
        `INSERT INTO jobs (id, site_id, customer_id, scheduled_for, status, service_type,
                           weight_lbs, containers_serviced, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           site_id = EXCLUDED.site_id,
           customer_id = EXCLUDED.customer_id,
           scheduled_for = EXCLUDED.scheduled_for,
           status = EXCLUDED.status,
           service_type = EXCLUDED.service_type,
           weight_lbs = EXCLUDED.weight_lbs,
           containers_serviced = EXCLUDED.containers_serviced,
           custom = EXCLUDED.custom`,
        [
          job.id, job.siteId, job.customerId, job.scheduledFor, job.status,
          job.serviceType, job.weightLbs ?? null, job.containersServiced ?? null,
          JSON.stringify(job.custom ?? {}),
        ]
      );
      return job;
    },
  };
}

// --- row mapping -----------------------------------------------------------
// snake_case in the database, camelCase in the domain. Confined to these three
// functions so the boundary is one place to look at, not scattered through
// every query.

function toCustomer(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string,
    name: r.name as string,
    serviceType: r.service_type as Customer["serviceType"],
    custom: asRecord(r.custom),
  };
}

function toSite(r: Record<string, unknown>): Site {
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    address: r.address as string,
    containers: Number(r.containers),
  };
}

function toJob(r: Record<string, unknown>): Job {
  return {
    id: r.id as string,
    siteId: r.site_id as string,
    customerId: r.customer_id as string,
    // Normalised to ISO 8601. Drivers differ: node-postgres returns Date
    // objects, others return strings — the domain sees one shape either way.
    scheduledFor: r.scheduled_for instanceof Date
      ? r.scheduled_for.toISOString()
      : new Date(String(r.scheduled_for)).toISOString(),
    status: r.status as JobStatus,
    serviceType: r.service_type as Job["serviceType"],
    weightLbs: r.weight_lbs == null ? undefined : Number(r.weight_lbs),
    containersServiced: r.containers_serviced == null ? undefined : Number(r.containers_serviced),
    custom: asRecord(r.custom),
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v === "string") {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return v as Record<string, unknown>;
}

// --- migrations ------------------------------------------------------------

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Forward-only migrations, tracked in `_core_migrations`.
 *
 * Idempotent: safe to run on every deploy, which is exactly what the tenant
 * deploy workflow does. Each migration runs inside a transaction, so a failure
 * leaves the schema at the last good state rather than half-applied.
 */
export async function migrate(db: Queryable): Promise<MigrateResult> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _core_migrations (
      id         text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await db.query(`SELECT id FROM _core_migrations`);
  const done = new Set(rows.map((r) => r.id as string));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const m of MIGRATIONS) {
    if (done.has(m.id)) {
      skipped.push(m.id);
      continue;
    }
    await db.query("BEGIN");
    try {
      // One statement per query: see the note in migrations/0001_core_schema.ts.
      for (const stmt of m.statements) await db.query(stmt);
      await db.query(`INSERT INTO _core_migrations (id) VALUES ($1)`, [m.id]);
      await db.query("COMMIT");
      applied.push(m.id);
    } catch (err) {
      await db.query("ROLLBACK");
      throw new Error(`Migration ${m.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { applied, skipped };
}

/** Load demo/starter data into a fresh tenant database. Idempotent. */
export async function seed(db: Queryable, data: SeedData): Promise<void> {
  for (const c of data.customers) {
    await db.query(
      `INSERT INTO customers (id, name, service_type, custom) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.serviceType, JSON.stringify(c.custom ?? {})]
    );
  }
  for (const s of data.sites) {
    await db.query(
      `INSERT INTO sites (id, customer_id, address, containers) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.customerId, s.address, s.containers]
    );
  }
  const store = createPostgresStore(db);
  for (const j of data.jobs) await store.saveJob(j);
}
