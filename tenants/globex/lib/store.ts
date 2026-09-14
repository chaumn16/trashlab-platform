import type { DataStore } from "@trashlab/core";
import { globexStore } from "../extensions/demo-data";
import { createPostgresStore, pgPoolConfig, caFromEnv } from "@trashlab/core/db";

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
    // Globex's demo overlay — adds the EPA generator codes that live in its own
    // schema. Replaced entirely by Postgres once DATABASE_URL is set.
    const store = globexStore();
    cached = store;
    return store;
  }

  // Imported dynamically, not with require(): these packages are ESM
  // ("type": "module"), where require is undefined. Bundlers shim it, so this
  // mistake builds cleanly and only fails at runtime. Keeping it lazy also means
  // local development never needs the driver installed.
  const { Pool } = await import("pg");

  // pgPoolConfig strips `sslmode` from the URL before configuring TLS. pg
  // parses sslmode out of the connection string and lets it override an
  // explicit ssl option, and it treats `require` as verify-full — which fails
  // against Supabase, Neon and Vercel Postgres with
  // "self-signed certificate in certificate chain".
  const pool = new Pool({
    ...pgPoolConfig(url, caFromEnv()),
    // Serverless: many short-lived instances, each needing very few connections.
    // Raise this only alongside a connection pooler.
    max: 3,
    idleTimeoutMillis: 10_000,
  });

  const store = createPostgresStore(pool as unknown as Parameters<typeof createPostgresStore>[0]);
  cached = store;
  return store;
}
