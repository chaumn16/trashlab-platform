/**
 * Builds node-postgres pool configuration from a connection string.
 *
 * ┌─ WHY THIS EXISTS ──────────────────────────────────────────────────────┐
 * │ Passing `{ connectionString, ssl }` to `new Pool()` does NOT do what it │
 * │ looks like. pg parses `sslmode` out of the connection string and the    │
 * │ parsed value OVERRIDES the explicit `ssl` option — silently.            │
 * │                                                                         │
 * │   ?sslmode=require    → ssl = {}                   (verify-full)        │
 * │   ?sslmode=no-verify  → ssl = {rejectUnauthorized:false}                │
 * │   (no sslmode)        → ssl = undefined                                 │
 * │                                                                         │
 * │ pg treats `require` as verify-full, which rejects the certificate       │
 * │ chains used by Supabase's pooler, Neon, and Vercel Postgres:            │
 * │                                                                         │
 * │   error: self-signed certificate in certificate chain                   │
 * │                                                                         │
 * │ So `sslmode` is stripped here and TLS is configured explicitly.         │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export interface PgPoolConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
}

/**
 * @param url  Postgres connection string.
 * @param caCert  PEM for the provider's root CA. When supplied, the server
 *   certificate is verified properly. Without it the connection is encrypted
 *   but the server's identity is unverified — the usual trade-off for managed
 *   Postgres, and worth closing where the provider publishes a CA.
 */
export function pgPoolConfig(url: string, caCert?: string): PgPoolConfig {
  // A local development database almost never offers TLS at all.
  if (/@(localhost|127\.0\.0\.1|\[::1\])/.test(url)) {
    return { connectionString: url, ssl: false };
  }

  let connectionString = url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    connectionString = parsed.toString();
  } catch {
    // Not parseable as a URL — leave it alone. pg will produce a clearer error
    // about the connection string than anything invented here.
  }

  return caCert
    ? { connectionString, ssl: { rejectUnauthorized: true, ca: caCert } }
    : { connectionString, ssl: { rejectUnauthorized: false } };
}

/** Root CA from the environment, if the operator supplied one. */
export function caFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.DATABASE_CA_CERT || env.PGSSLROOTCERT || undefined;
}
