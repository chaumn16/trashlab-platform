# Runbook: rolling core across the fleet

> This is the fleet-wide procedure. For a single tenant's change lifecycle, see
> [SDLC.md](SDLC.md); §7 there covers how a tenant receives an upgrade it did not
> ask for.

## Normal release

```bash
cd packages/core && npm version minor && git push --follow-tags   # CI packs + releases
platform fleet rollout --to=4.3.0 --channel=canary --apply    # internal + ~5 friendly tenants
platform fleet rollout --to=4.3.0 --channel=beta   --batch=5%  --apply
platform fleet rollout --to=4.3.0 --channel=stable --batch=10% --apply
```

Per batch: open PR → CI (boundary, types, conformance, build) → auto-merge on
green → migrate → deploy → smoke test → 30-minute health gate → next batch.

### Two rules that matter more than the pipeline

**One tenant's failure never blocks the fleet.** A red CI run parks that tenant
on its current version, files a ticket with the diff, and the rollout continues.
Stragglers are chased asynchronously.

**Config-only tenants auto-merge; custom-code tenants get a PR.** This split is
what keeps a 2,000-tenant rollout from needing 2,000 humans. `platform fleet
status` shows which is which in the `CUSTOM` column.

### Health gates

Breach halts the rollout. Already-deployed batches stay up — halting is not
rolling back.

| Signal | Threshold |
|---|---|
| 5xx rate | > 1% over 30 min |
| p95 latency | > 1.5× the pre-rollout baseline |
| Completed-jobs-priced | any drop vs. same weekday |
| Conformance failures in batch | > 10% |

Dashboards slice by `coreVersion`, which is how you see "4.3.0 is bad on 3
tenants" instead of "errors are up".

## Security patch

Bypasses tenant review. This path must exist **before** you have 2,000 tenants.

```bash
platform fleet rollout --to=4.2.4 --channel=all --batch=25% --gate=error_rate<2% --apply
```

Backport to every supported major. Force-merge regardless of `hasCustomCode`.
Notify tenant owners after the fact, not before.

## Breaking change

1. Add the new API alongside the old one; deprecate the old with a console warning.
2. Ship a codemod in the major.
3. Fleet runner applies it across every repo in the same PR that bumps the pin.
4. Custom-code tenants review; config-only tenants auto-merge.
5. Remove the old API no sooner than two majors later.

## Migrations

Core migrations are **expand/contract**, always. Tenants run different core
versions against their own databases, and rollback must stay compatible with a
migrated schema.

- **Expand:** add the column/table, dual-write, backfill. Ships in release N.
- **Contract:** drop the old column. Ships in release N+2, never earlier.

A migration that makes the previous build fail is a rollback you cannot perform.

## Drift

```bash
platform fleet status --drift
```

Watch three numbers. Drift is what tells you this model is failing *before* it
becomes a crisis:

- tenants behind `stable`
- age of the oldest deployed core version
- tenants past `pinExpiry`
