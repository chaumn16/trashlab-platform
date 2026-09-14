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
| `@trashlab/cli` | **CLI** | run from the repo or `npm i -g` | engineer laptops + CI |

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

**There is no package registry.** Core is built into a tarball, attached to a
GitHub Release, and vendored into each tenant repo at `vendor/`. Nothing is
published anywhere.

### Cut a release

```bash
npm run pack -w @trashlab/core      # builds, then packs → dist-releases/
```

That produces `dist-releases/trashlab-core-<version>.tgz` (~15KB). To release it:

```bash
cd packages/core && npm version minor    # 4.2.3 → 4.3.0
git push --follow-tags
```

Pushing the tag runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
rebuilds, runs the demo tenants' conformance suites, packs, and attaches the
tarball to a GitHub Release. If core breaks its own extension contract, no tenant
is ever offered the build.

`files: ["dist"]` in `package.json` means only compiled output is packed —
tenants never receive core's TypeScript sources, which is what keeps
`src/extend/types.ts` the contract rather than the whole source tree.

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

Channels (`canary` / `beta` / `stable`) live in the registry
(`registry/tenants.json`), not in npm dist-tags. Promotion is a registry change
plus a rollout, never a tag move.

### Verify

```bash
gh release list --repo chaumn16/trashlab-platform
shasum -a 256 dist-releases/trashlab-core-4.3.0.tgz
platform fleet status                      # who is on what
```

---

## 2. Deploy the control plane

A Next.js app serving the fleet dashboard and the callback API that every
tenant's CI and deploy workflows post to.

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | fleet dashboard — versions, drift, health, provisioning, events |
| `/tenants/new` | GET | **the Add-tenant form sales uses** |
| `/api/tenants` | GET | the registry as data |
| `/api/tenants` | POST | provision a tenant programmatically (CRM integration) |
| `/api/ci-result` | POST | tenant CI reports pass/fail per PR |
| `/api/deploy-result` | POST | tenant deploys report success + URL |

### Link the project

```bash
cd apps/control-plane
vercel link          # create a project named trashlab-control-plane
```

### ⚠ Root Directory — the step that breaks first

The control plane lives in a monorepo and imports the registry from the repo
root (`registry/tenants.json`). In **Project Settings → General**:

- **Root Directory** → `apps/control-plane`
- **Include source files outside of the Root Directory** → **ON**

With that setting off, the build fails with `Module not found:
../../../registry/tenants.json`. This is the single most common failure when
deploying this app.

Also set **Node.js Version → 22.x**.

### Environment variables

```bash
openssl rand -hex 32                                  # generate a real token
vercel env add CONTROL_PLANE_TOKEN production
vercel env add CONTROL_PLANE_TOKEN preview

# Lets the Add-tenant form start the provisioning workflow
vercel env add GITHUB_DISPATCH_TOKEN production
vercel env add PLATFORM_REPO production               # chaumn16/trashlab-platform
```

**`GITHUB_DISPATCH_TOKEN` is deliberately weak.** A fine-grained PAT with
*Contents: read and write* on the platform repo only. It triggers a workflow; it
does not provision. `VERCEL_TOKEN` and the fleet GitHub token live in GitHub
Actions secrets and never touch the web app — see
[§2b](#2b-the-provisioning-workflow) for why.

Leave it unset and the console still works: requests are validated and listed,
but nothing is dispatched.

See [`apps/control-plane/.env.example`](../apps/control-plane/.env.example) for
the full list. Locally, copy it to `.env.local`.

**The token fails closed.** If `CONTROL_PLANE_TOKEN` is unset, every API route
returns `503`, never an open endpoint. An unconfigured control plane refuses
writes rather than accepting anonymous ones.

### Deploy

```bash
vercel --prod
vercel domains add control.trashlab.app
```

### Verify

```bash
CP=https://control.trashlab.app
T=<the token you generated>

curl -s -o /dev/null -w "dashboard: %{http_code}\n" $CP/                        # 200
curl -s -o /dev/null -w "no auth:   %{http_code}\n" $CP/api/tenants             # 401
curl -s -H "Authorization: Bearer $T" $CP/api/tenants | head -c 200             # the fleet

curl -s -X POST $CP/api/ci-result \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":"globex","sha":"abc1234","status":"success"}'                 # {"ok":true}
```

Open the dashboard — you should see the fleet table, the drift panel, and the
event you just posted.

### 2b. The provisioning workflow

The console does **not** provision. It validates the request and dispatches
[`.github/workflows/provision-tenant.yml`](../.github/workflows/provision-tenant.yml),
which runs `platform tenant add --apply`.

Three reasons, and they are worth understanding before you "simplify" it:

1. **Provisioning takes minutes** — repo, database, project, domain, deploy.
   Serverless functions time out; a workflow does not.
2. **Blast radius.** `VERCEL_TOKEN` and the fleet GitHub token can create repos
   and deploy anywhere in the fleet. A sales-facing web app is the wrong place
   for them.
3. **Retry and audit for free.** "Who onboarded this customer, and when" is
   answerable from the Actions history.

Set these once on the platform repo:

```bash
gh secret   set VERCEL_TOKEN        --repo chaumn16/trashlab-platform
gh secret   set FLEET_GITHUB_TOKEN  --repo chaumn16/trashlab-platform   # repo + workflow scope
gh variable set VERCEL_TEAM_ID      --repo chaumn16/trashlab-platform --body "team_xxxx"
```

The workflow runs `tenant add` **as a dry run first**, then with `--apply`. A bad
slug or a duplicate fails before anything is created — provisioning is far
cheaper to prevent than to unwind.

### 2c. Put the console behind SSO

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
npm i -g ./packages/cli && platform fleet status    # or install globally
```

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
