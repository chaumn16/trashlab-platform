# Tenant migrations

Tables that exist only for this tenant. This tenant has its **own database**, so
you can add whatever you need without coordinating with any other tenant — and
without any risk of colliding with one.

## Rules

1. **Never alter a core-owned table.** Core migrations assume exclusive ownership
   and a core upgrade will clobber your change.
2. **Prefix everything with `t_`** so core can tell tenant tables from its own.
3. **Forward-only.** No down migrations. Rollback is handled by redeploying the
   previous build, which is why core migrations are expand/contract — see below.

```sql
-- 0001_compliance_manifests.sql
CREATE TABLE IF NOT EXISTS t_compliance_manifests (
  id          text PRIMARY KEY,
  job_id      text NOT NULL,
  epa_code    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

## When these run

The deploy workflow runs migrations before the new build takes traffic, so a
release never serves against a schema it doesn't expect.

**Today that step is skipped.** It is guarded on `DATABASE_URL`, which is unset
while the sample runs on core's in-memory store
(`packages/core/src/db/store.ts` marks the swap point). The `migrate` command
ships with the Postgres implementation; until then these files are declarations
of intent, not something that executes.

## Why rollback stays safe

Core migrations are **expand/contract**: expand (add the column, dual-write,
backfill) ships in one release, contract (drop the old column) no sooner than two
releases later. That is what lets a tenant roll back to the previous build
against an already-migrated schema.

Follow the same discipline here. A migration that makes the previous build fail
is a rollback you cannot perform.
