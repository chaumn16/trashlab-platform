import { createStore } from "@trashlab/core";
import type { DataStore } from "@trashlab/core";
import { createPostgresStore } from "@trashlab/core/db";

/**
 * Resolves this tenant's data source.
 *
 * With `DATABASE_URL` set — production — it is this tenant's own Postgres, and
 * nothing else's. Isolation comes from the connection string: there is no tenant
 * column to forget in a WHERE clause.
 *
 * Without it — local development — it is core's seeded in-memory store, so the
 * app runs with no database at all.
 *
 * The pool is cached across requests. Serverless invocations reuse a warm
 * module, and a new pool per request would exhaust Postgres connections under
 * any real traffic.
 */
let cached: DataStore | null = null;

export async function getStore(): Promise<DataStore> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    const store = createStore();
    cached = store;
    return store;
  }

  // Imported dynamically, not with require(): these packages are ESM
  // ("type": "module"), where require is undefined. Bundlers shim it, so this
  // mistake builds cleanly and only fails at runtime. Keeping it lazy also means
  // local development never needs the driver installed.
  const { Pool } = await import("pg");

  // Vercel Postgres and Neon require TLS; a local database usually does not.
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    // Serverless: many short-lived instances, each needing very few connections.
    // Raise this only alongside a connection pooler.
    max: 3,
    idleTimeoutMillis: 10_000,
  });

  const store = createPostgresStore(pool as unknown as Parameters<typeof createPostgresStore>[0]);
  cached = store;
  return store;
}
