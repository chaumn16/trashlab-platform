#!/usr/bin/env node
/**
 * @trashlab/core CLI. Runs inside a tenant's deploy, before the new build takes
 * traffic — see the tenant template's .github/workflows/deploy.yml.
 *
 *   npx @trashlab/core migrate --database "$DATABASE_URL"
 *   npx @trashlab/core seed    --database "$DATABASE_URL"
 *
 * The `pg` driver is resolved from the TENANT app, not bundled into core. Core
 * stays driver-agnostic (see db/postgres.ts), and a tenant on a different
 * Postgres client is not forced onto ours.
 */
import { migrate, createPostgresStore, seed } from "../dist/db/postgres.js";
import { pgPoolConfig, caFromEnv } from "../dist/db/connect.js";
import { defaultSeed } from "../dist/db/store.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

const url = flag("database") ?? process.env.DATABASE_URL;

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(`
@trashlab/core

  migrate --database <url>   apply core migrations (forward-only, idempotent)
  seed    --database <url>   load starter data into a fresh tenant database

Reads DATABASE_URL from the environment when --database is omitted.
`);
  process.exit(cmd ? 0 : 1);
}

if (!["migrate", "seed"].includes(cmd)) {
  console.error(`Unknown command "${cmd}". Try: migrate, seed`);
  process.exit(1);
}

if (!url) {
  console.error(
    "No database URL.\n" +
      "  Pass --database <url>, or set DATABASE_URL.\n" +
      "  The tenant deploy workflow skips this step entirely when DATABASE_URL is unset."
  );
  process.exit(1);
}

let Pool;
try {
  ({ Pool } = await import("pg"));
} catch {
  console.error(
    "Cannot find the 'pg' package.\n" +
      "  Core does not bundle a Postgres driver. Add it to the tenant app:\n" +
      "    npm install pg"
  );
  process.exit(1);
}

// pgPoolConfig strips `sslmode` from the URL before configuring TLS: pg lets a
// connection-string sslmode override an explicit ssl option, and treats
// `require` as verify-full, which fails against Supabase/Neon/Vercel Postgres
// with "self-signed certificate in certificate chain".
const pool = new Pool({ ...pgPoolConfig(url, caFromEnv()), max: 1 });

try {
  if (cmd === "migrate") {
    const { applied, skipped } = await migrate(pool);
    if (applied.length) console.log(`applied:  ${applied.join(", ")}`);
    if (skipped.length) console.log(`already:  ${skipped.join(", ")}`);
    if (!applied.length) console.log("schema is up to date");
  } else {
    await seed(pool, defaultSeed());
    const store = createPostgresStore(pool);
    const jobs = await store.listJobs();
    console.log(`seeded — ${jobs.length} jobs present`);
  }
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
