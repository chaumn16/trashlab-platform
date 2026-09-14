# Deploying a tenant

Every tenant is an independent Vercel project, backed by its own GitHub repo and
its own Postgres database, running a pinned version of `@trashlab/core`.

There are four procedures. Only the first involves a human decision.

> These are the mechanics. For the lifecycle around them — who triages a request,
> which gates a change passes, who reviews, and how a tenant is decommissioned —
> see **[SDLC.md](SDLC.md)**.

> **First time here?** This document assumes the platform is already deployed —
> core published, control plane live. If it isn't, start with
> [DEPLOY-PLATFORM.md](DEPLOY-PLATFORM.md). For the hands-on setup of a single tenant — `vercel link`, env
> vars, the first deploy, domains, CI wiring, and troubleshooting — see
> **[VERCEL.md](VERCEL.md)**.

---

## 1. Add a new tenant

Triggered by **sales**. No engineer, no ticket.

### The sales path: the console

Open the control plane → **Add tenant** (`/tenants/new`), fill in four fields:

| Field | Notes |
|---|---|
| Company name | as it appears in their app header |
| Subdomain | leave blank to derive it from the name — **permanent**, it becomes the URL, repo, and Vercel project |
| Plan | starter / growth / enterprise |
| Region | set once, at creation |

Submit. The console validates (slug format, reserved subdomains, duplicates)
and starts the provisioning workflow; the request appears on the dashboard and
the tenant is live in about four minutes.

Everything else — core version, tier, database, CI, branch protection — is
decided by the platform, not typed in by whoever closed the deal.

### The engineer path: the CLI

Same work, from a terminal. Useful for scripting and for debugging a failed
console request:

```bash
platform tenant add northwind --name="Northwind Disposal" --plan=growth --apply
```

### The integration path: the API

For provisioning on "deal won" straight from a CRM. Shares the console's
validation, so the two cannot drift:

```bash
curl -X POST https://control.trashlab.app/api/tenants \
  -H "Authorization: Bearer $CONTROL_PLANE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Northwind Disposal","plan":"growth","region":"iad1"}'
```

Seven automated steps, ~4 minutes end to end:

| # | Step | Result |
|---|------|--------|
| 1 | Scaffold repo from `templates/tenant-starter` | placeholders substituted |
| 2 | Create GitHub repo, protect `main` | CODEOWNERS + required checks live |
| 3 | Provision Postgres | dedicated DB, tenant's region |
| 4 | Create Vercel project | linked to the repo, `DATABASE_URL` injected |
| 5 | Attach domain | `northwind.trashlab.app`, TLS issued |
| 6 | Migrate + deploy | core `stable`, smoke-tested |
| 7 | Register | tenant appears in `platform fleet status` |

The command is **idempotent and resumable** — a failure at step 5 is fixed by
re-running it, not by unpicking the first four steps.

Drop `--apply` to see every API call without making one. That is the default,
which is what makes this command safe to hand to a sales engineer: the
destructive path needs both an explicit flag and a token they don't hold.

### Verify

```bash
platform fleet status
curl -sI https://northwind.trashlab.app | head -1    # expect 200
```

---

## 2. Change a tenant's code

The triage order matters. Most requests should stop at step 1.

**① Config?** Toggle it in the console. No deploy, no PR, seconds.
Feature flags, branding, custom field definitions.

**② Extension point?** Edit the tenant repo — by hand or by agent.

```bash
git clone git@github.com:trashlab/tenant-northwind.git
cd tenant-northwind && npm install
# edit tenant.config.ts / extensions/ / app/ / migrations/
npm test          # core conformance — run it before you push
git checkout -b pricing-tweak && git commit -am "..." && git push
```

Opening the PR gets you a Vercel preview URL against a branched database.
CI runs the import boundary, typecheck, conformance suite, and build. Merge
deploys **that tenant only**.

First time a tenant gets custom code, flag it:

```bash
platform tenant customize northwind --apply
```

This changes its rollout treatment — core bumps now open a reviewable PR instead
of auto-merging.

**③ Neither?** It's a platform request. Two options, in order of preference:

- **Extend core** with a new named extension point — a semver-minor that every
  tenant can then use. This is the outcome you want.
- **Eject** to a fork. Requires VP sign-off and a written reason. Each ejection
  is reviewed for the extension point that was missing.

### What an agent may and may not touch

Enforced by `CODEOWNERS` + branch protection, not by convention:

| Writable by agent | Requires platform-team review |
|---|---|
| `tenant.config.ts` | `tenant.lock` (tier, channel, core version) |
| `extensions/` | `.github/` (CI and deploy) |
| `app/` (custom routes) | `package.json` / `package-lock.json` |
| `migrations/` | `next.config.mjs`, `CODEOWNERS` |
| `tests/` | |

An agent cannot change its own core version, edit CI, or reach deploy secrets.
Its worst case is a red build on one tenant.

---

## 3. Deploy a single tenant

```bash
platform tenant deploy northwind --apply                        # current pin
platform tenant deploy northwind --core-version=4.3.0 --apply   # bump, then deploy
```

Merging to `main` does the same thing automatically via `.github/workflows/deploy.yml`:
migrate → build → deploy → smoke test `/`, `/jobs`, `/customers` → auto-rollback
if any path is non-200.

A green build that renders a 500 is still a failed deploy. At 2,000 tenants
nobody is watching individual sites, so the smoke test is not optional.

---

## 4. Roll back

```bash
vercel rollback --token=$VERCEL_TOKEN --yes     # instant, previous build
platform tenant deploy northwind --core-version=4.2.3 --apply   # pin backwards
```

Core migrations are expand/contract, so the previous build stays compatible with
the migrated schema. This is the property that makes rollback safe, and it is a
hard rule on every core migration — see `RUNBOOK-rollout.md`.

---

## Secrets

Per-repo, scoped to one tenant. A compromised agent or leaked token in one repo
cannot reach another tenant.

| Secret | Scope |
|---|---|
| `VERCEL_TOKEN` | one Vercel project |
| `DATABASE_URL` | one Postgres database |
| `CONTROL_PLANE_TOKEN` | write CI/deploy status for this tenant only |

Repo variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `CONTROL_PLANE_URL`.

---

## Vercel capacity

See [VERCEL.md §7](VERCEL.md#8-capacity-limits-to-settle-early) for the same list
with the provisioning details. In short, three limits to settle before the fleet
passes ~400 tenants:

1. **Projects per team.** 2,000 needs an Enterprise agreement.
2. **Build concurrency.** This is the real constraint. A fleet-wide core bump is
   2,000 builds that serialize against your concurrency limit — it directly sets
   your "how fast can we patch a CVE" SLA. Negotiate this number explicitly.
3. **Per-tenant regions.** Set at provision time; the only supported path for
   customers with data-residency terms.
