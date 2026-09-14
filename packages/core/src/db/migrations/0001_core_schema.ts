/**
 * Core-owned schema, as a TypeScript module rather than a loose .sql file so it
 * survives bundling — Next traces imports, not arbitrary files on disk.
 *
 * Core tables are unprefixed. Tenant tables use `t_` (see the tenant template's
 * migrations/README.md), so `\dt` on any tenant database tells you immediately
 * which tables core owns and which the tenant added.
 *
 * Migrations are forward-only and expand/contract: expand in release N, contract
 * no sooner than N+2, so rolling a tenant back to the previous build still works
 * against the migrated schema.
 *
 * ONE STATEMENT PER ENTRY. A multi-statement string only executes on Postgres's
 * simple query protocol; node-postgres happens to use it for parameterless
 * queries, but PGlite and several serverless drivers use prepared statements and
 * reject "multiple commands". Splitting here keeps migrations driver-portable
 * instead of silently coupling us to one client.
 */
export const id = "0001_core_schema";

export const statements: string[] = [
`CREATE TABLE IF NOT EXISTS customers (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  service_type text NOT NULL,
  custom       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS sites (
  id          text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address     text NOT NULL,
  containers  integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS jobs (
  id                  text PRIMARY KEY,
  site_id             text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  customer_id         text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  scheduled_for       timestamptz NOT NULL,
  status              text NOT NULL,
  service_type        text NOT NULL,
  weight_lbs          integer,
  containers_serviced integer,
  custom              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
)`,
`CREATE INDEX IF NOT EXISTS jobs_customer_idx  ON jobs (customer_id)`,
`CREATE INDEX IF NOT EXISTS jobs_status_idx    ON jobs (status)`,
`CREATE INDEX IF NOT EXISTS jobs_scheduled_idx ON jobs (scheduled_for)`,
`CREATE INDEX IF NOT EXISTS sites_customer_idx ON sites (customer_id)`,
];
