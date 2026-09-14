# Deploying a tenant to Vercel

> Deploying the **platform** itself — publishing `@trashlab/core` and deploying
> the control plane — is [DEPLOY-PLATFORM.md](DEPLOY-PLATFORM.md). Do that first;
> a tenant has nothing to install and nowhere to report until it exists.

Hands-on instructions for standing up a tenant on Vercel — by hand the first
time, then automated for the remaining 1,999.

Do this manually at least once. `platform tenant add` automates exactly these
steps, and you cannot debug the automation without having done it yourself.

> **The sample deploys with no database.** `packages/core/src/db/store.ts` is an
> in-memory store, so you can deploy a tenant and see it live before any Postgres
> exists. Skip every `DATABASE_URL` step below until you swap in the real store.

---

## 0. Prerequisites

```bash
npm i -g vercel
vercel login
```

You need a Vercel account. The Hobby plan is enough to deploy one tenant and try
this end to end; scaling to 2,000 projects needs Enterprise (see
[Capacity](#7-capacity-limits-to-settle-early)).

---

## 1. Link the repo to a Vercel project

From a clone of the **tenant** repo:

```bash
git clone https://github.com/chaumn16/tenant-globex.git
cd tenant-globex
vercel link
```

Answer the prompts: pick your scope, choose **Create a new project**, name it
`tenant-globex`. This writes `.vercel/project.json`:

```json
{ "orgId": "team_xxxxxxxx", "projectId": "prj_xxxxxxxx" }
```

Those two values are the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` that CI needs.
`.vercel/` is gitignored — never commit it.

```bash
cat .vercel/project.json          # copy these into GitHub repo variables
```

### If you deploy from the platform monorepo instead

The demo tenants live at `tenants/globex` inside `trashlab-platform`. Vercel
needs to know that:

- **Project Settings → General → Root Directory** → `tenants/globex`
- Turn **off** "Include files outside the root directory" only if the tenant is
  self-contained. The demo tenants resolve `@trashlab/core` through the npm
  workspace at the repo root, so they **need** it left on.

Production tenants are standalone repos and need none of this — which is part of
why repo-per-tenant is the simpler model to operate.

---

## 2. Build settings

Vercel detects Next.js and gets this right by default. Two things it cannot
guess:

**Node version.** Project Settings → General → Node.js Version → **22.x** or
later. The conformance suite runs TypeScript directly via node's type stripping,
which needs ≥ 22.6.

**Private registry access.** `@trashlab/core` installs from GitHub Packages. The
repo's `.npmrc` already reads a token from the environment:

```
@trashlab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${CORE_REGISTRY_TOKEN}
```

So the install works as soon as `CORE_REGISTRY_TOKEN` exists as an environment
variable (next step). Without it the build fails at `npm install` with a 401 on
`@trashlab/core`.

---

## 3. Environment variables

```bash
vercel env add CORE_REGISTRY_TOKEN production    # GitHub PAT with read:packages
vercel env add TENANT_ID production              # e.g. globex
vercel env add DATABASE_URL production           # once the store is real
```

Add them to `preview` too if you want PR previews to build:

```bash
vercel env add CORE_REGISTRY_TOKEN preview
vercel env add TENANT_ID preview
```

| Variable | Scope | Purpose |
|---|---|---|
| `CORE_REGISTRY_TOKEN` | production + preview | install `@trashlab/core` |
| `TENANT_ID` | production + preview | tags logs and metrics by tenant |
| `DATABASE_URL` | production | this tenant's Postgres — **only this tenant's** |

`DATABASE_URL` is the isolation boundary. Each Vercel project holds exactly one,
pointing at exactly one database. That is why cross-tenant leakage is
structurally impossible rather than something code review has to catch.

---

## 4. Deploy

```bash
vercel --prod
```

Vercel prints a deployment URL. Check it:

```bash
curl -sI https://<deployment-url> | head -1     # expect HTTP/2 200
```

Then open `/jobs/job_1003` and confirm Globex's weight-bracket pricing
(**$810.90**), the **Manifests** nav item, and the EPA panel on job detail.

### The prebuilt path (what CI uses)

Faster and reproducible — build locally or in CI, upload the artifact:

```bash
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

This is what [`.github/workflows/deploy.yml`](../templates/tenant-starter/.github/workflows/deploy.yml)
runs, so a failure there reproduces exactly with these three commands.

---

## 5. Automatic deploys from GitHub

Two options. Pick one — running both double-deploys every merge.

**A. Vercel's Git integration** (simplest). Project Settings → Git → connect the
repo. Every push to `main` deploys to production; every PR gets a preview URL.
Then **delete `.github/workflows/deploy.yml`**, or you get two deploys per merge.

**B. GitHub Actions** (what this platform uses). Keeps deploys under the same
control plane as migrations, smoke tests, and rollback. Requires these repo
secrets and variables:

```bash
gh secret set VERCEL_TOKEN          # Account Settings → Tokens, scoped to the team
gh secret set CORE_REGISTRY_TOKEN
gh secret set DATABASE_URL
gh secret set CONTROL_PLANE_TOKEN
gh variable set VERCEL_ORG_ID       --body "team_xxxxxxxx"
gh variable set VERCEL_PROJECT_ID   --body "prj_xxxxxxxx"
gh variable set CONTROL_PLANE_URL   --body "https://control.trashlab.internal"
```

Choose **B** for a real fleet: the smoke test and auto-rollback in that workflow
are the things that let you deploy 2,000 tenants without watching any of them.

---

## 6. Domains

Per-tenant subdomain:

```bash
vercel domains add globex.trashlab.app
```

Or Project Settings → Domains. TLS is issued automatically.

For a fleet, point a wildcard at Vercel once and every future tenant's subdomain
resolves without a DNS change:

```
*.trashlab.app    CNAME    cname.vercel-dns.com
```

Customer vanity domains (`waste.globex.com`) are added to that tenant's project
individually; the customer creates the CNAME on their side.

---

## 7. Capacity limits to settle early

Three things to confirm with Vercel **before the fleet passes ~400 tenants**:

1. **Projects per team.** 2,000 projects needs an Enterprise agreement. Confirm
   the ceiling before you're near it.
2. **Build concurrency — the real constraint.** A fleet-wide core bump is 2,000
   builds serializing against your concurrency limit. This number *is* your
   "how fast can we patch a CVE" SLA. Negotiate it explicitly and write it down.
3. **Regions.** Set per project at creation (`regions: ["iad1"]` in the CLI's
   provisioning call). This is the only supported path for customers with
   data-residency terms, and it cannot be retrofitted cheaply.

---

## 8. Rollback

```bash
vercel rollback --yes                  # instant, previous production deployment
vercel rollback <deployment-url> --yes # or a specific one
vercel ls tenant-globex                # list deployments
```

Rollback is safe because core migrations are expand/contract: the previous build
stays compatible with the migrated schema. A migration that breaks the previous
build is a rollback you cannot perform — see
[`RUNBOOK-rollout.md`](RUNBOOK-rollout.md).

---

## 9. Once it works by hand, automate it

Everything above collapses into one command:

```bash
export VERCEL_TOKEN=... VERCEL_TEAM_ID=... GITHUB_TOKEN=...
platform tenant add northwind --name="Northwind Disposal" --apply
```

Repo, database, project, env vars, domain, TLS, migration, deploy, smoke test,
registry entry — ~4 minutes, idempotent, resumable. Drop `--apply` to see every
API call it would make without making one.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm install` 401 on `@trashlab/core` | `CORE_REGISTRY_TOKEN` missing or lacks `read:packages` | `vercel env add CORE_REGISTRY_TOKEN production`, redeploy |
| `Module not found: @trashlab/core` | deploying from the monorepo with Root Directory set but files outside it excluded | re-enable "Include files outside the root directory" |
| Build fails on `.ts` imports in tests | Node < 22.6 | Project Settings → Node.js Version → 22.x |
| Deploy succeeds, site 500s | usually a missing env var, not a code bug | `vercel logs <url>` |
| Two deploys per merge | Git integration **and** the Actions workflow are both active | disable one (§5) |
| `vercel: command not found` in CI | the workflow installs it per-run | `npm i -g vercel@latest` before `vercel pull` |
