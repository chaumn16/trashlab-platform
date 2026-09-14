/**
 * node-postgres TLS configuration.
 *
 * Deliberately duplicated from @trashlab/core/db rather than imported: the
 * control plane is platform infrastructure and takes no dependency on the
 * product package, so that deploying the console never requires a core release.
 *
 * pg parses `sslmode` out of the connection string and the parsed value
 * OVERRIDES an explicit `ssl` option — silently. It also treats `require` as
 * verify-full, which rejects the certificate chains used by Supabase's pooler,
 * Neon, and Vercel Postgres:
 *
 *   error: self-signed certificate in certificate chain
 *
 * So sslmode is stripped here and TLS configured explicitly. Set
 * DATABASE_CA_CERT (or PGSSLROOTCERT) to the provider's root CA to get real
 * certificate verification instead of encryption alone.
 */
export interface PgPoolConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
}

export function pgPoolConfig(url: string): PgPoolConfig {
  if (/@(localhost|127\.0\.0\.1|\[::1\])/.test(url)) {
    return { connectionString: url, ssl: false };
  }
  let connectionString = url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    connectionString = parsed.toString();
  } catch {
    /* pg will report a better error than we can */
  }
  const ca = process.env.DATABASE_CA_CERT || process.env.PGSSLROOTCERT;
  return ca
    ? { connectionString, ssl: { rejectUnauthorized: true, ca } }
    : { connectionString, ssl: { rejectUnauthorized: false } };
}
