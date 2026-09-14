# Deploying the platform

The main app, as opposed to the tenants. Deploy this **before** any tenant —
`platform tenant add` depends on all three pieces existing.

For deploying a tenant app, see [VERCEL.md](VERCEL.md) and [DEPLOY.md](DEPLOY.md).

---

## What "the platform" actually is

Three deployable units, and only one is a web app:

| Unit | What it is | How it ships | Where it runs |
|---|---|---|---|
| `@trashlab/core` | built **tarball** | GitHub Release → vendored into each tenant repo | inside each tenant's build |
| `@trashlab/control-plane` | Next.js **service** | Vercel project | `control.trashlab.app` |
| `@trashlab/cli` | **CLI** | run from a clone, or `npm i -g ./packages/cli` | engineer laptops + CI |

Core is never "deployed" anywhere, and never published to a registry. It is
built, released as an artifact, and vendored into tenant repos. It reaches
production only when a tenant whose `vendor/` tarball was swapped is deployed.
That indirection is the whole point: cutting a release changes nothing until a
tenant is deployed, which is what makes staged rollouts possible.

**Order of operations:**

```
1. release @trashlab/core      → tenants have something to vendor
2. deploy the control plane    → tenants have somewhere to report
3. distribute the CLI          → engineers can provision
4. then: platform tenant add
```

---

## 1. Release `@trashlab/core`

**There is no package registry** — not npm, not GitHub Packages, not a private
mirror. Core is built into a tarball, attached to a GitHub Release, and vendored
into each tenant repo at `vendor/`. Nothing is published anywhere, and a tenant
needs no credential to install it.

You can check that claim rather than trust it. In any tenant repo:

```bash
ls .npmrc 2>/dev/null || echo "no .npmrc — nothing points at a registry"
node -p "require('./package.json').dependencies['@trashlab/core']"
#   file:vendor/trashlab-core-4.2.3.tgz
node -p "require('./package-lock.json').packages['node_modules/@trashlab/core'].resolved"
#   file:vendor/trashlab-core-4.2.3.tgz    ← a path, not a URL
```

**To be precise about the scope of the claim:** *core* needs no registry and no
credential. A tenant's other dependencies — `next`, `react`, `pg` — are ordinary
public packages and still install from npm as usual. What vendoring removes is
the private registry, the auth token, and the ability for a core release to be
blocked by a registry outage.

### Cut a release

```bash
npm run pack -w @trashlab/core      # builds, then packs → dist-releases/
```

That produces `dist-releases/trashlab-core-<version>.tgz` (~22KB). To release it:

```bash
cd packages/core && npm version minor    # 4.2.3 → 4.3.0
git push --follow-tags
```

Pushing the tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
rebuilds, runs the demo tenants' conformance suites, packs, and attaches the
tarball to a GitHub Release. If core breaks its own extension contract, no tenant
is ever offered the build.

`files: ["dist", "bin"]` in `package.json` means only compiled output and the
`trashlab-core` CLI are packed — tenants never receive core's TypeScript sources,
which is what keeps `src/extend/types.ts` the contract rather than the whole
source tree.

### Cutting a release deploys nothing

The release asset is inert until the fleet controller vendors it into a tenant
repo and that tenant deploys. That indirection is what makes staged rollouts
possible:

```bash
platform fleet rollout --to=4.3.0 --channel=canary --apply
```

For each tenant in the batch this swaps `vendor/*.tgz`, repoints
`package.json`, and updates `tenant.lock` in one commit — so `git log` on a
tenant repo is an honest record of which bytes ran when.

Channels (`canary` / `beta` / `stable`) live in the **tenant registry**
(`registry/tenants.json`) — the fleet's own table of who runs what, not a package
registry. Promotion is an entry change plus a rollout, never a tag move.

> "Registry" means two different things in this codebase and only one of them
> exists here. The **tenant registry** is `registry/tenants.json`. A **package
> registry** — npm, GitHub Packages — is not used at all.

### Verify

```bash
gh release list --repo chaumn16/trashlab-platform
shasum -a 256 dist-releases/trashlab-core-4.3.0.tgz
platform fleet status                      # who is on what
```

---

## 2. Deploy the control plane

A Next.js app serving the fleet dashboard, the Add-tenant form sales uses, and
the callback API every tenant's CI and deploy workflows post to.

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | fleet dashboard — versions, drift, health, provisioning, events |
| `/tenants/new` | GET | **the Add-tenant form sales uses** |
| `/api/tenants` | GET | the registry as data |
| `/api/tenants` | POST | provision a tenant programmatically (CRM integration) |
| `/api/ci-result` | POST | tenant CI reports pass/fail per PR |
| `/api/deploy-result` | POST | tenant deploys report success + URL |

### 2a. Create its database — do this first

> Rehearse locally: `npm run db:up`, then
> `docker exec trashlab-pg createdb -U trashlab control_plane` and run the app
> with that `DATABASE_URL`. Same migrate-and-seed-on-boot path as production.

The control plane has its **own** Postgres, separate from every tenant's. It
holds data *about* tenants (registry, events, provisioning requests), never data
*belonging to* them.

In the Vercel dashboard: **Storage → Create Database → Postgres**, named
`control-plane`. Neon works identically; any Postgres will do.

Without `DATABASE_URL` the app still runs — it reads the bundled
`registry/tenants.json` and keeps writes in memory. That is correct for local
development and **wrong in production**: serverless instances do not share
memory, so provisioning requests and CI events would vanish between requests.

Schema and seed are automatic. On first use the app creates its tables and loads
the bundled registry, so the dashboard is populated on the very first request
rather than empty.

### 2b. Link and configure the project

```bash
cd apps/control-plane
vercel link          # create a project named trashlab-control-plane
```

**Project Settings → General:**

- **Root Directory** → `apps/control-plane`
- **Include source files outside of the Root Directory** → **ON**
- **Node.js Version** → 22.x

That second setting is not optional: the app imports `registry/tenants.json`
from the repo root for its initial seed. With it off the build fails with
`Module not found: ../../../registry/tenants.json`.

### 2c. Environment variables

```bash
openssl rand -hex 32                                  # generate a real token
vercel env add CONTROL_PLANE_TOKEN production
vercel env add CONTROL_PLANE_TOKEN preview
vercel env add DATABASE_URL production                # from step 2a
vercel env add GITHUB_DISPATCH_TOKEN production       # lets the form start provisioning
vercel env add PLATFORM_REPO production               # chaumn16/trashlab-platform
```

**`CONTROL_PLANE_TOKEN` fails closed.** Unset, every API route returns `503` —
never an open endpoint. The dashboard still renders, which is the most common way
to get a half-configured deployment that looks fine.

**`GITHUB_DISPATCH_TOKEN` is deliberately weak**: a fine-grained PAT with
*Contents: read and write* on the platform repo only. It triggers a workflow; it
does not provision. `VERCEL_TOKEN` and the fleet GitHub token live in GitHub
Actions secrets and never touch the web app — see [§2e](#2e-the-provisioning-workflow).

### 2d. Deploy and verify

```bash
vercel --prod
vercel domains add control.trashlab.app
```

Run all five checks. Each one catches a different half-configured state:

```bash
CP=https://control.trashlab.app
T=<the token you generated>

# 1. dashboard renders
curl -s -o /dev/null -w "dashboard: %{http_code}\n" $CP/

# 2. auth is enforced (401, NOT 503 — 503 means DATABASE_URL/token missing)
curl -s -o /dev/null -w "no auth:   %{http_code}\n" $CP/api/tenants

# 3. the fleet reads back from Postgres, not the bundled JSON
curl -s -H "Authorization: Bearer $T" $CP/api/tenants | head -c 200

# 4. a CI callback persists
curl -s -X POST $CP/api/ci-result \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":"globex","sha":"abc1234","status":"success"}'

# 5. it survived — reload the dashboard and the event is listed.
#    If it is not, DATABASE_URL is unset and you are on the in-memory path.
```

Check 5 is the one that matters. Everything else can pass on a control plane that
silently forgets every write.

### 2e. The provisioning workflow

The console does **not** provision. It validates the request and dispatches
[`.github/workflows/provision-tenant.yml`](../.github/workflows/provision-tenant.yml),
which runs `platform tenant add --apply`.

1. **Provisioning takes minutes** — repo, database, project, domain, deploy.
   Serverless functions time out; a workflow does not.
2. **Blast radius.** `VERCEL_TOKEN` and the fleet GitHub token can create repos
   and deploy anywhere in the fleet. A sales-facing web app is the wrong place
   for them.
3. **Retry and audit for free.** "Who onboarded this customer, and when" is
   answerable from the Actions history.

```bash
gh secret   set VERCEL_TOKEN        --repo chaumn16/trashlab-platform
gh secret   set FLEET_GITHUB_TOKEN  --repo chaumn16/trashlab-platform   # repo + workflow scope
gh variable set VERCEL_TEAM_ID      --repo chaumn16/trashlab-platform --body "team_xxxx"
```

The workflow runs `tenant add` as a dry run **first**, then with `--apply`. A bad
slug or a duplicate fails before anything is created.

### 2f. Put the console behind SSO

`/tenants/new` creates customers and `/` lists every one of them. Neither page is
token-protected — they are human UI, and a bearer token in a browser is not auth.

Enable **Vercel Authentication** (Project Settings → Deployment Protection) or
put your own IdP in front. Do this before sharing the URL with anyone, including
sales.

---

## 3. Wire tenants to the control plane

Every tenant repo needs these, set once at provisioning by
`platform tenant add`:

```bash
gh variable set CONTROL_PLANE_URL --body "https://control.trashlab.app" --repo trashlab/tenant-globex
gh secret   set CONTROL_PLANE_TOKEN --body "$T"                        --repo trashlab/tenant-globex
```

Reporting is deliberately **best-effort** — both workflows end their curl with
`|| true`. A control-plane outage degrades fleet visibility; it must never fail a
tenant's deploy.

---

## 4. Distribute the CLI

```bash
node packages/cli/bin/platform.mjs fleet status     # from a clone
npm i -g ./packages/cli && platform fleet status    # or install from the local path
```

Note the `./` — `npm i -g @trashlab/cli` without it would look on the public npm
registry, where the name is unclaimed. For the same reason, tenant workflows call
`./node_modules/.bin/trashlab-core` rather than `npx trashlab-core`: `npx` falls
back to the public registry when a local binary is missing, which would let a
failed install execute someone else's package with `DATABASE_URL` in scope.

Operators need:

```bash
export VERCEL_TOKEN=...        # project, domain, deployment scope
export VERCEL_TEAM_ID=...
export GITHUB_TOKEN=...        # repo creation + branch protection
export CONTROL_PLANE_URL=https://control.trashlab.app
export CONTROL_PLANE_TOKEN=...
```

Every command is dry-run by default. `--apply` executes.

---

## Before real traffic

The control plane as committed is honest about being a demo. Three things must
change before it runs a real fleet:

1. **Replace the registry store.** Reads come from a JSON file bundled at build
   time; writes go to an in-process array that is lost on cold start and is not
   shared between serverless instances. `apps/control-plane/lib/registry.ts`
   marks the swap point — move it to Vercel Postgres, Neon, or KV. Every caller
   stays identical.
2. **Issue per-tenant tokens.** `lib/auth.ts` checks one shared token. The design
   calls for a token per tenant so a leak from one repo can only write that
   tenant's status, matching every other credential in this system. This is the
   one place the demo is weaker than the architecture it implements.
3. **Put the console behind SSO** (§2c). It lists every customer and can create
   more. It must not be a public URL.
4. **Record who requested each tenant.** The console sends `requestedBy:
   "console"` because there is no identity to read yet. Once SSO is in front, pass
   the authenticated user through — provisioning a customer should never be
   anonymous.
