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
cd ../.. && npm install                  # refresh the root lockfile
git push --follow-tags
```

**Don't skip the `npm install`.** `npm version` inside a workspace leaves the
root `package-lock.json` describing the old version, and the next CI run installs
against a lockfile that disagrees with the tree.

The demo tenants in `tenants/` depend on `"@trashlab/core": "*"` precisely so a
version bump cannot break them — they link the workspace whatever its version.
Pinning them to an exact version means every core release breaks `npm install` at
the repo root until all of them are updated in lockstep:

```
npm error 404  '@trashlab/core@4.2.3' is not in this registry
```

npm cannot satisfy an exact version from a workspace at a different version, so it
falls through to the public registry — where `@trashlab/core` does not exist.

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

→ **[DEPLOY-CONTROL-PLANE.md](DEPLOY-CONTROL-PLANE.md)** — the full runbook:
database, project settings, environment variables, deploy, a five-step
verification, SSO, and troubleshooting. About 20 minutes.

The short version, and the three things that most often go wrong:

1. **Create its Postgres first.** The control plane has its own database,
   separate from every tenant's. Without `DATABASE_URL` the app still renders and
   still answers — it just forgets every write between requests, because
   serverless instances share no memory.
2. **Root Directory `apps/control-plane`, and "Include source files outside of
   the Root Directory" ON** — it imports `registry/tenants.json` from the repo
   root for its initial seed.
3. **`CONTROL_PLANE_TOKEN` fails closed.** Unset, every API route returns `503`
   rather than serving openly. The dashboard still works, which is how you end up
   with a half-configured deployment that looks healthy.

Verify by posting an event to `/api/ci-result` and reloading the dashboard. If it
is not listed, you are on the in-memory path — every other check passes anyway.

Then put it behind SSO before sharing the URL: `/tenants/new` creates customers
and `/` lists them all, and neither page is token-protected.

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
