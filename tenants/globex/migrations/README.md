# Tenant migrations

Tables that exist only for this tenant. This tenant has its **own database**, so
you can add whatever you need without coordinating with any other tenant.

Rules:

1. **Never alter a core-owned table.** Core migrations assume exclusive
   ownership and a core upgrade will clobber your change.
2. **Prefix everything** with `t_` so core can tell tenant tables from its own.
3. Migrations are **forward-only** and run automatically at deploy, before the
   new build receives traffic.

    -- 0001_compliance_manifests.sql
    CREATE TABLE t_compliance_manifests (
      id text PRIMARY KEY,
      job_id text NOT NULL,
      epa_code text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
