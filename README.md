# TrashLab platform

A bespoke app per customer, at ~2,000 customers, without 2,000 forks.

One versioned core package (`@trashlab/core`), one thin repo per tenant that
imports it, one Vercel project and one Postgres database per tenant, and a
control plane that provisions and rolls out across the fleet.

📐 **[Architecture & diagrams](docs/ARCHITECTURE.md)**
🏗 **[Deploy the platform](docs/DEPLOY-PLATFORM.md)** — publish core, deploy the control plane (**start here**)
▲ **[Deploy a tenant to Vercel](docs/VERCEL.md)** · 🚀 **[Tenant runbook](docs/DEPLOY.md)** · 🔄 **[Fleet rollouts](docs/RUNBOOK-rollout.md)**

---

## Repository layout

```
apps/control-plane/          fleet dashboard + the CI/deploy callback API
packages/core/               @trashlab/core — the product
  src/extend/types.ts        ← the entire public contract tenants may depend on
  src/domain/runtime.ts      ← the guard between core and tenant-authored code
  src/conformance/           ← the CI gate every tenant repo runs
packages/cli/                platform CLI — provision, deploy, rollout, drift
templates/tenant-starter/    what `platform tenant add` stamps out
tenants/acme/                in-repo demo tenant (see note below)
tenants/globex/              in-repo demo tenant with custom business logic
registry/tenants.json        fleet source of truth
docs/                        architecture, platform + tenant deploys, rollout runbooks
```

> **On `tenants/` being in this repo.** In production every tenant is its **own
> GitHub repo** — that boundary is what bounds an AI agent's blast radius. These
> two exist here so core developers can run a real tenant app without cloning
> one, and so changes to the extension API can be smoke-tested before publishing.
> The standalone form lives at
> [`chaumn16/tenant-globex`](https://github.com/chaumn16/tenant-globex).

---

## Local setup

**Requirements:** Node ≥ 20 (tested on 26), npm ≥ 10. No database needed — the
sample runs against an in-memory store.

```bash
git clone https://github.com/chaumn16/trashlab-platform.git
cd trashlab-platform
npm install
npm run build -w @trashlab/core
```

`npm run build -w @trashlab/core` is required before anything else — the tenant
apps import core's compiled output from `packages/core/dist`.

### Run the two demo tenants

```bash
npm run dev -w tenant-globex   # http://localhost:3000
npm run dev -w tenant-acme     # http://localhost:3001
```

Open `/jobs/job_1003` on both. Same core version, different businesses:

| | Acme (config only) | Globex (custom) |
|---|---|---|
| Pricing | core rate card → **$569.00** | weight brackets + disposal + fuel → **$810.90** |
| Nav | core routes | adds **Manifests** |
| Job detail | core only | EPA manifest panel via slot |
| Core version | 4.2.3 | 4.2.3 |

Globex's entire divergence is four files: a pricing hook, a validation hook, two
slot renderers, one custom route. Neither app is a fork.

### Run the control plane

The fleet dashboard and the API every tenant's CI reports to:

```bash
cp apps/control-plane/.env.example apps/control-plane/.env.local
# set CONTROL_PLANE_TOKEN to anything for local dev
npm run dev -w @trashlab/control-plane     # http://localhost:3002
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:3002/api/tenants
curl -s -X POST localhost:3002/api/ci-result \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tenantId":"globex","sha":"abc1234","status":"success"}'
```

Auth **fails closed**: with `CONTROL_PLANE_TOKEN` unset every API route returns
`503`, never an open endpoint.

### Run the CLI

```bash
platform() { node packages/cli/bin/platform.mjs "$@"; }

platform fleet status                                        # fleet + version drift
platform tenant add northwind --name="Northwind Disposal"     # provision (dry run)
platform fleet rollout --to=4.3.0 --batch=50                  # staged rollout (dry run)
```

**Every command is dry-run by default** and prints the exact Vercel and GitHub
API calls it would make. Add `--apply` to execute. That default is what makes
`tenant add` safe to hand to a sales engineer.

### Verify a change to core

```bash
npm run build -w @trashlab/core
npm test -w tenant-globex     # conformance suite
npm run lint -w tenant-globex # import boundary
```

Try breaking the contract in `tenants/globex/extensions/pricing.ts` — read the
clock, return fractional cents, let line items disagree with the total — and the
conformance suite names the exact rule you broke.

---

## Production setup

Deploy in this order. Tenants depend on all three platform pieces existing.

```
1. publish @trashlab/core      → tenants have something to install
2. deploy the control plane    → tenants have somewhere to report
3. distribute the CLI          → engineers can provision
4. then: platform tenant add
```

### Step 1–3: the platform → **[docs/DEPLOY-PLATFORM.md](docs/DEPLOY-PLATFORM.md)**

Publishing core (and how dist-tags implement the release channels), deploying
the control plane to Vercel, and the three things that must change before it
carries real traffic.

Core is never deployed anywhere — it is *published*, and reaches production only
when a tenant's build installs it. That indirection is what makes staged
rollouts possible.

Shared infrastructure you need once:

| Resource | Purpose |
|---|---|
| Vercel team (Enterprise) | 2,000 projects needs an Enterprise agreement |
| Wildcard DNS `*.trashlab.app` | per-tenant subdomains |
| GitHub org + `platform-team` | CODEOWNERS reviews, repo creation |
| Control-plane deployment | tenant registry, CI/deploy callbacks |

### Step 4: the first tenant → **[docs/VERCEL.md](docs/VERCEL.md)**

Step-by-step Vercel setup for a single tenant: link the project, set env vars,
deploy, wire up domains and CI. Do it by hand once — `platform tenant add`
automates exactly those steps, and you can't debug the automation without having
done it yourself.

The sample deploys with **no database** — the store is in-memory — so you can get
a tenant live before any Postgres exists.

### Credentials for the CLI

```bash
export VERCEL_TOKEN=...      # project + domain + deployment scope
export VERCEL_TEAM_ID=...
export GITHUB_TOKEN=...      # repo creation + branch protection
export CONTROL_PLANE_URL=https://control.trashlab.app
export CONTROL_PLANE_TOKEN=...
```

> **Settle Vercel capacity before ~400 tenants.** Project count needs an
> Enterprise agreement, and **build concurrency is the real constraint** — a
> fleet-wide core bump is 2,000 builds serializing against your limit, which
> directly sets your "how fast can we patch a CVE" SLA. Negotiate that number
> explicitly.

### Add a tenant

Once a project has been stood up by hand at least once
([docs/VERCEL.md](docs/VERCEL.md)), this replaces all of it:

```bash
platform tenant add northwind --name="Northwind Disposal" --plan=growth --apply
```

Seven automated steps, ~4 minutes, idempotent and resumable. Triggered by sales,
not engineering:

1. Scaffold repo from `templates/tenant-starter`
2. Create GitHub repo, protect `main` (CODEOWNERS + required checks)
3. Provision dedicated Postgres
4. Create Vercel project, inject `DATABASE_URL`
5. Attach `northwind.trashlab.app`, issue TLS
6. Migrate + deploy core `stable`, smoke test
7. Register in the fleet

Verify:

```bash
platform fleet status
curl -sI https://northwind.trashlab.app | head -1   # expect 200
```

### Deploy and roll back

```bash
platform tenant deploy northwind --apply
platform tenant deploy northwind --core-version=4.3.0 --apply
vercel rollback --token=$VERCEL_TOKEN --yes          # instant, previous build
```

Merging to `main` in a tenant repo does the same automatically: migrate → build →
deploy → smoke test `/`, `/jobs`, `/customers` → auto-rollback on any non-200.

### Roll core across the fleet

```bash
platform fleet rollout --to=4.3.0 --channel=canary --apply
platform fleet rollout --to=4.3.0 --channel=beta   --batch=5%  --apply
platform fleet rollout --to=4.3.0 --channel=stable --batch=10% --apply
```

Batched with 30-minute health gates. Config-only tenants auto-merge on green;
custom-code tenants get a reviewable PR. A red CI run parks that tenant and files
a ticket — **it never blocks the fleet**.

Full procedures including security patches, breaking changes, and expand/contract
migrations: [`docs/RUNBOOK-rollout.md`](docs/RUNBOOK-rollout.md).

---

## How a tenant stays safe with AI-authored code

Four mechanically enforced layers — see the
[enforcement diagram](docs/ARCHITECTURE.md#3-the-four-enforcement-layers):

| Layer | Mechanism | Catches |
|---|---|---|
| ① Import boundary | ESLint `no-restricted-imports` | reaching into core internals |
| ② Conformance suite | `@trashlab/core/conformance` in CI | non-determinism, negative totals, line items that don't reconcile, loosened core invariants |
| ③ CODEOWNERS | branch protection | edits to `tenant.lock`, CI, `package.json` |
| ④ Runtime guard | timeout + validated fallback | hooks that throw, hang, or return junk **in production** |

An agent's worst case is a red build on one tenant. It cannot change its own core
version, edit CI, reach deploy secrets, or affect any other tenant.

---

## Status

Architecture, extension contract, conformance suite, CLI, and both sample tenants
are real and verified — builds, typechecks, lint, and tests all pass.

Two things are deliberately stubbed and marked in source. Neither changes the
command surface or the architecture:

- **Data layer is in-memory.** `packages/core/src/db/store.ts` marks the Postgres
  swap point; production is one database per tenant, where isolation comes from
  the connection string rather than a `WHERE` clause.
- **The control plane's store is not durable.** The service is real and
  deployable — dashboard, authenticated API, fail-closed tokens — but reads come
  from a JSON file bundled at build time and writes go to an in-process array
  that is lost on cold start. `apps/control-plane/lib/registry.ts` marks the swap
  point. See [DEPLOY-PLATFORM.md](docs/DEPLOY-PLATFORM.md#before-real-traffic)
  for the full list of what to change before real traffic.
