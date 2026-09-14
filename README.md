# TrashLab platform

A bespoke app per customer, at ~2,000 customers, without 2,000 forks.

One versioned core package (`@trashlab/core`), one thin repo per tenant that
imports it, one Vercel project and one Postgres database per tenant, and a
control plane that provisions and rolls out across the fleet.

📐 **[Architecture & diagrams](docs/ARCHITECTURE.md)** · 🔁 **[Tenant SDLC](docs/SDLC.md)** — how a change reaches a customer, and who owns each step
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
docs/                        architecture, SDLC, platform + tenant deploys, rollout runbooks
```

> **On `tenants/` being in this repo.** In production every tenant is its **own
> GitHub repo** — that boundary is what bounds an AI agent's blast radius. These
> two exist here so core developers can run a real tenant app without cloning
> one, and so changes to the extension API can be smoke-tested before publishing.
> The standalone form lives at
> [`chaumn16/tenant-globex`](https://github.com/chaumn16/tenant-globex).

---

## Run everything locally

Three apps: the control plane (what sales uses) and two tenant apps. All three
run side by side on pinned ports.

**Requirements:** Node ≥ 22.6 (tested on 26), npm ≥ 10. No database, no registry
credentials, no Vercel account.

### 1. Install

```bash
git clone https://github.com/chaumn16/trashlab-platform.git
cd trashlab-platform
npm install
```

### 2. Build core

```bash
npm run build -w @trashlab/core
```

Required before running either tenant — they import core's compiled output. Skip
it and you get `Module not found: Can't resolve '@trashlab/core/app'`. Re-run it
after any change to `packages/core/src`.

Not needed for the control plane, which doesn't depend on core.

### 3. Run the apps

| App | Command | URL |
|---|---|---|
| Control plane | `npm run dev -w @trashlab/control-plane` | <http://localhost:3002> |
| Globex (customized tenant) | `npm run dev -w tenant-globex` | <http://localhost:3000> |
| Acme (config-only tenant) | `npm run dev -w tenant-acme` | <http://localhost:3001> |

Each in its own terminal. Ports are pinned per package so they don't collide.

The control plane needs a token before its API will answer — auth fails closed,
so an unset token returns `503` on every route rather than leaving it open:

```bash
cp apps/control-plane/.env.example apps/control-plane/.env.local
```

Set `CONTROL_PLANE_TOKEN` to anything for local work. Leave
`GITHUB_DISPATCH_TOKEN` blank — tenant requests will then be validated and listed
but never dispatched, so nothing real gets created.

### 4. What to look at

**The fleet** — <http://localhost:3002>. Three tenants, and a drift panel
flagging `initech` stranded on core 3.9.4.

**How sales onboards a customer** — <http://localhost:3002/tenants/new>. Company
name, subdomain, plan, region. Leave the subdomain blank to watch it derive one.
Try `acme` (duplicate) or `admin` (reserved) to see the guardrails. You'll get
*"Request recorded — not provisioned"*, because no dispatch token is set.

**Two businesses, one core** — open `/jobs/job_1003` on both tenants:

| | Acme :3001 | Globex :3000 |
|---|---|---|
| Total | **$569.00** | **$810.90** |
| Strategy | core default rate card v4 | globex: weight-bracket, bracket ≤12,000 lbs |
| Nav | core routes only | adds **Manifests** |
| Job detail | core only | EPA manifest panel via slot |
| Core version | 4.2.3 | 4.2.3 |

Globex's entire divergence is four files. Neither app is a fork.

**The CLI**

```bash
platform() { node packages/cli/bin/platform.mjs "$@"; }

platform fleet status                                       # versions, drift, health
platform tenant add northwind --name="Northwind Disposal"   # provision (dry run)
platform fleet rollout --to=4.3.0 --batch=50                # staged rollout (dry run)
```

Dry-run by default; every command prints the exact Vercel and GitHub calls it
would make. `--apply` executes.

### 5. Verify a change to core

```bash
npm run build -w @trashlab/core
npm test -w tenant-globex        # conformance suite
npm run lint -w tenant-globex    # import boundary
```

Try breaking the contract in `tenants/globex/extensions/pricing.ts` — read the
clock, return fractional cents, let line items disagree with the total — and the
conformance suite names the exact rule you broke.

### Running a tenant that has its own repo

Production tenants live in their own repos. `tenant-globex` is the same tenant in
that form:

```bash
git clone https://github.com/chaumn16/tenant-globex.git
cd tenant-globex
npm install        # no token needed — core is vendored, see below
npm run dev
```

It defaults to port 3000, so if the monorepo copy is already running Next will
pick another port automatically.

To test an unpublished core against it, clone this repo as a sibling directory
and:

```bash
npm run link:core      # point at ../trashlab-platform/packages/core
npm run dev
npm run unlink:core    # restore the vendored tarball
```

Never commit a lockfile produced while linked — it encodes a local path.

### Notes

- **State resets on restart.** The control plane's provisioning requests and
  events live in memory (`apps/control-plane/lib/registry.ts` marks the swap
  point), and tenant data is a seeded in-memory store
  (`packages/core/src/db/store.ts`).
- **No login anywhere.** Fine locally; the first thing to fix before deploying
  the control plane.
- **`initech` has no code.** It exists only as a registry row to demonstrate
  version drift. There is nothing to run.

---

## How core reaches a tenant

**There is no package registry.** Not public, not private, none.

`@trashlab/core` is built into a 15KB tarball and **committed into each tenant
repo at `vendor/`**. `package.json` points at it with
`"@trashlab/core": "file:vendor/trashlab-core-4.2.3.tgz"`.

```bash
npm run pack -w @trashlab/core     # → dist-releases/trashlab-core-<version>.tgz
```

Why this rather than a registry:

- **A tenant repo needs zero platform credentials.** Clone, `npm install`,
  `npm run dev`. No `.npmrc`, no token, nothing to leak or rotate. That matters
  most for the direction where customers work in their own repos.
- **CI can't 401 or rate-limit.** At ~2,000 installs per core release, an install
  step that depends on a registry being up is a fleet-wide outage waiting to
  happen.
- **The exact bytes are visible in the repo and in every diff**, and
  `package-lock.json` still records a sha512 integrity hash, so tampering is
  still detectable.
- **Rollback is a file swap.**

The canonical artifact for a release is the GitHub Release asset on this repo.
The fleet controller downloads it and commits it into tenant repos, replacing the
old one, in the same PR that updates `package.json` and `tenant.lock` — so
`git log` on a tenant repo is an honest record of which bytes ran when. `vendor/`
is CODEOWNERS-protected; agents cannot change their own core version.

Channels (`canary` / `beta` / `stable`) live in `registry/tenants.json` — see
[docs/RUNBOOK-rollout.md](docs/RUNBOOK-rollout.md).

---

## Production setup

Deploy in this order. Tenants depend on all three platform pieces existing.

```
1. release @trashlab/core      → tenants have something to vendor
2. deploy the control plane    → tenants have somewhere to report
3. distribute the CLI          → engineers can provision
4. then: platform tenant add
```

### Step 1–3: the platform → **[docs/DEPLOY-PLATFORM.md](docs/DEPLOY-PLATFORM.md)**

Releasing core as a tarball (no registry anywhere), deploying the control plane
to Vercel, and the things that must change before it carries real traffic.

Core is never deployed anywhere and never published to a registry — it is built,
released as an artifact, and vendored into tenant repos. It reaches production
only when a tenant whose tarball was swapped is deployed. That indirection is
what makes staged rollouts possible.

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

Sales does this from the console — **Add tenant**, four fields, ~4 minutes. See
[docs/DEPLOY.md §1](docs/DEPLOY.md#1-add-a-new-tenant).

The equivalent from a terminal, once a project has been stood up by hand at
least once ([docs/VERCEL.md](docs/VERCEL.md)):

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
