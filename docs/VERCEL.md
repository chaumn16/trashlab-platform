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

## 1. Which path are you on?

A tenant can live in one of two places, and the Vercel setup differs:

| | **Path A — own repo** | **Path B — in the platform monorepo** |
|---|---|---|
| Lives at | `chaumn16/tenant-globex` | `trashlab-platform/tenants/<slug>` |
| Gets core from | npm, pinned (`4.2.3`) | workspace symlink to `packages/core` |
| Vercel Root Directory | repo root (default) | `tenants/<slug>` |
| Build triggers | pushes to that repo | **any** monorepo push, unless filtered |
| Who it's for | every production tenant | core development, demos, pre-repo tenants |

**Production tenants use Path A.** The repo boundary is what bounds an AI agent's
blast radius and scopes deploy credentials to one tenant.

Path B exists because core developers need to run a real tenant without cloning
one, and because a tenant that hasn't been customized yet doesn't need a repo of
its own. When it gets one, see
[§10 Promoting a monorepo tenant](#10-promoting-a-monorepo-tenant-to-its-own-repo).

---

## Path A — tenant with its own repo

```bash
git clone https://github.com/chaumn16/tenant-globex.git
cd tenant-globex
vercel link
```

Answer the prompts: pick your scope, **Create a new project**, name it
`tenant-globex`. This writes `.vercel/project.json`:

```json
{ "orgId": "team_xxxxxxxx", "projectId": "prj_xxxxxxxx" }
```

Those are the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` that CI needs. `.vercel/`
is gitignored — never commit it.

```bash
cat .vercel/project.json          # copy into GitHub repo variables
```

Root Directory stays at the default. Nothing else to configure — continue to
[§2 Build settings](#2-build-settings).

---

## Path B — tenant inside the platform monorepo

```bash
cd trashlab-platform
vercel link          # from the REPO ROOT, not from tenants/<slug>
```

Then, in **Project Settings → General**:

- **Root Directory** → `tenants/acme`
- **Include source files outside of the Root Directory** → **ON**

That second setting is not optional. A monorepo tenant resolves
`@trashlab/core` through an npm workspace symlink at the repo root
(`node_modules/@trashlab/core → ../../packages/core`), so the build genuinely
needs files above its root. With it off, the build fails with
`Module not found: @trashlab/core`.

### ⚠ Stop every push rebuilding every tenant

With Vercel's Git integration, **any** push to the monorepo triggers a build for
**every** tenant project pointed at it. Three tenants means three builds for a
README typo; at fleet scale it is a serious waste of build concurrency — the
resource that sets your CVE-patch SLA.

Set **Project Settings → Git → Ignored Build Step** to a path filter, per tenant
project:

```bash
git diff --quiet HEAD^ HEAD -- tenants/acme packages/core
```

Vercel's contract: **exit 0 skips the build, exit 1 continues it.** `git diff
--quiet` exits 0 when nothing changed and 1 when something did — which is exactly
backwards from intuition and exactly right here. Include `packages/core` so a
core change still rebuilds the tenants that consume it.

This problem does not exist on Path A: one repo, one project, one trigger.

---

## 2. Build settings

Vercel detects Next.js and gets this right by default. Two things it cannot
guess:

**Node version.** Project Settings → General → Node.js Version → **22.x** or
later. The conformance suite runs TypeScript directly via node's type stripping,
which needs ≥ 22.6.

**Private registry access — Path A only.** `@trashlab/core` installs from GitHub
Packages. The repo's `.npmrc` already reads a token from the environment:

```
@trashlab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${CORE_REGISTRY_TOKEN}
```

So the install works as soon as `CORE_REGISTRY_TOKEN` exists as an environment
variable (next step). Without it the build fails at `npm install` with a 401 on
`@trashlab/core`.

Path B needs none of this: core resolves through the workspace symlink, so the
package is never fetched from a registry at all.

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
| `CORE_REGISTRY_TOKEN` | production + preview | install `@trashlab/core` — **Path A only**; Path B resolves core through the workspace and needs no token |
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

On Path B this is the option that needs the Ignored Build Step path filter, or
every monorepo push rebuilds every tenant.

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

## 10. Promoting a monorepo tenant to its own repo

When a Path B tenant starts carrying real custom code, give it a repo. This is
the same procedure that produced
[`chaumn16/tenant-globex`](https://github.com/chaumn16/tenant-globex).

```bash
cp -R trashlab-platform/tenants/acme tenant-acme
cd tenant-acme
rm -rf node_modules .next
```

Three things change, because the workspace symlink is gone:

**1. Core becomes a real dependency.** It already reads `"@trashlab/core": "4.2.3"`
in `package.json` — that pin was resolved by the workspace locally and now
resolves from the registry. Add an `.npmrc` so npm knows where to look:

```
@trashlab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${CORE_REGISTRY_TOKEN}
```

**2. Add a `.gitignore`** — it was inherited from the monorepo root:

```
node_modules/
.next/
.vercel/
.env
.env.local
```

**3. Add local-dev escape hatches** for working against an unpublished core:

```json
"link:core":   "npm pkg set dependencies.@trashlab/core=\"file:../trashlab-platform/packages/core\" && npm install",
"unlink:core": "npm pkg set dependencies.@trashlab/core=\"4.2.3\""
```

Then push and repoint Vercel:

```bash
git init -b main && git add -A && git commit -m "Extract tenant-acme"
gh repo create tenant-acme --private --source=. --remote=origin --push
```

In the Vercel project: **Settings → Git** → disconnect the monorepo, connect
`tenant-acme`, reset **Root Directory** to the default, and delete the Ignored
Build Step — it is no longer needed. The domain, environment variables, and
deployment history all stay with the project.

Finally, mark it in the registry so the fleet controller switches it from
auto-merge to reviewed core bumps:

```bash
platform tenant customize acme --apply
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm install` 401 on `@trashlab/core` | `CORE_REGISTRY_TOKEN` missing or lacks `read:packages` | `vercel env add CORE_REGISTRY_TOKEN production`, redeploy |
| `Module not found: @trashlab/core` | **Path B**: Root Directory set but files outside it excluded | turn on "Include source files outside of the Root Directory" |
| `Module not found: @trashlab/core` | **Path A**: no `.npmrc`, or core not published | add `.npmrc`, or `npm run link:core` for local work |
| Every tenant rebuilds on any push | **Path B** with no path filter | set Ignored Build Step (§ Path B) |
| Tenant deploys but shows another tenant's branding | Root Directory points at the wrong `tenants/<slug>` | fix Root Directory, redeploy |
| Build fails on `.ts` imports in tests | Node < 22.6 | Project Settings → Node.js Version → 22.x |
| Deploy succeeds, site 500s | usually a missing env var, not a code bug | `vercel logs <url>` |
| Two deploys per merge | Git integration **and** the Actions workflow are both active | disable one (§5) |
| `vercel: command not found` in CI | the workflow installs it per-run | `npm i -g vercel@latest` before `vercel pull` |
