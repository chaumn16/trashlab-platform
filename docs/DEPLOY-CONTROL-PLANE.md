# Deploying the control plane to Vercel

The control plane is the platform's only web app. It serves the fleet dashboard,
the Add-tenant form sales uses, and the callback API every tenant's CI and deploy
workflows report to.

Deploy it **before** any tenant: tenants report to it, and `platform tenant add`
expects it to exist.

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | fleet dashboard — versions, drift, health, provisioning, events |
| `/tenants/new` | GET | the Add-tenant form sales uses |
| `/api/tenants` | GET | the fleet as data |
| `/api/tenants` | POST | provision a tenant programmatically (CRM integration) |
| `/api/ci-result` | POST | tenant CI reports pass/fail per PR |
| `/api/deploy-result` | POST | tenant deploys report success + URL |

**Time:** about 20 minutes. **You need:** a Vercel account, the GitHub repo, and
`vercel` CLI (`npm i -g vercel && vercel login`).

---

## Rehearse locally first (optional, 3 minutes)

Every step below has a local equivalent, and the local path exercises the same
code. Worth doing once so a failure on Vercel is obviously configuration rather
than code.

```bash
npm run db:up
docker exec trashlab-pg createdb -U trashlab control_plane

DATABASE_URL=postgres://trashlab:devpass@localhost:5433/control_plane \
CONTROL_PLANE_TOKEN=dev-token \
  npm run dev -w @trashlab/control-plane -- --port 3005
```

Open <http://localhost:3005>. The app creates its own schema and seeds the fleet
on first request — no migration command to run.

---

## Step 1 — Create its database

**Do this before deploying.** The control plane has its **own** Postgres,
separate from every tenant's. It holds data *about* tenants (the registry,
events, provisioning requests), never data *belonging to* them.

Vercel dashboard → **Storage** → **Create Database** → **Postgres** → name it
`control-plane`. Neon works identically; any Postgres will do.

Copy the connection string; you need it in Step 3.

> **Why this is step one.** Without `DATABASE_URL` the app still starts, still
> renders, and still answers — it reads the bundled `registry/tenants.json` and
> keeps writes in memory. On a laptop that is correct. On Vercel it is a trap:
> serverless instances do not share memory, so provisioning requests and CI
> events silently vanish between requests. The app will look healthy and forget
> everything.

Nothing to migrate by hand. On first use the app creates its four tables
(`tenants`, `channels`, `fleet_events`, `provision_requests`) and seeds them from
the bundled registry, so the dashboard is populated on the very first request
rather than empty.

---

## Step 2 — Create and configure the Vercel project

```bash
cd apps/control-plane
vercel link          # scope → Create a new project → name it trashlab-control-plane
```

Then, in **Project Settings → General**, three settings Vercel cannot infer:

| Setting | Value | Why |
|---|---|---|
| **Root Directory** | `apps/control-plane` | it is a monorepo app |
| **Include source files outside of the Root Directory** | **ON** | it imports `registry/tenants.json` from the repo root for its initial seed |
| **Node.js Version** | 22.x | the app and its deps assume ≥ 22 |

Two failures come from getting these wrong, and neither names the real cause:

| Symptom | Which setting |
|---|---|
| `Module not found: ../../../registry/tenants.json` | "Include source files outside…" is **off** |
| `No Output Directory named "public" found` | **Root Directory** is not `apps/control-plane` |

The second one is confusing because it sounds like a static-site problem. What
actually happened is that Vercel read the *repo root* `package.json` — a
workspace root with no `next` dependency and no build script — detected no
framework, fell back to the "Other" preset, and went looking for a `public/`
directory that will never exist.

`apps/control-plane/vercel.json` declares `"framework": "nextjs"` so detection
cannot drift once Root Directory is right. It does not substitute for the
setting: Vercel only reads that file after Root Directory points at the app.

### Stop every repo push rebuilding it

> **Add this after your first successful deployment, not before.** The filter
> skips the build when the watched paths are untouched — and on a brand-new
> project, if your latest commit happens to be a docs change, that means no first
> deployment at all.

With Vercel's Git integration, **any** push triggers a build — including README
edits. Set **Project Settings → Git → Ignored Build Step**.

**Use the committed script:**

```
sh "$(git rev-parse --show-toplevel)/scripts/vercel-ignore-build.sh" apps/control-plane registry
```

If you would rather paste the logic directly, it **must be a single line**:

```
cd "$(git rev-parse --show-toplevel)" || exit 1; git fetch --deepen=1 --quiet 2>/dev/null || true; git rev-parse --verify --quiet HEAD^ >/dev/null || exit 1; git diff --quiet HEAD^ HEAD -- apps/control-plane registry
```

Three traps. The first is the dangerous one — it fails *silently*:

**Vercel runs this from the project's Root Directory, not the repo root.** Git
pathspecs are cwd-relative, so `git diff -- apps/control-plane` executed *inside*
`apps/control-plane` matches nothing, concludes "no changes", and **skips every
deployment forever** — with no error to explain it. Hence the
`$(git rev-parse --show-toplevel)`: both forms above anchor themselves to the
repo root, and the paths you pass are always repo-relative. A bare
`scripts/vercel-ignore-build.sh` fails with `No such file or directory` for the
same reason.

**Vercel clones shallow (depth 1), so `HEAD^` usually does not exist.** A bare
`git diff --quiet HEAD^ HEAD` fails with `fatal: bad revision 'HEAD^'` and exits
**128** — outside the 0/1 contract entirely. `--deepen=1` fetches the one extra
commit the comparison needs, and if there is still no parent, it builds.

**Vercel runs this through `/bin/sh -c` as a single line.** A multi-line
`if … then … fi` pasted into the settings box collapses and fails with
`syntax error near unexpected token 'then'`. Use `||` and `;` as above, or the
script.

Vercel's contract is inverted from intuition: **exit 0 skips the build, exit 1
continues it.** `git diff --quiet` exits 0 when nothing changed and 1 when
something did — which is exactly right. Include `registry` because the bundled
seed lives there.

---

## Step 3 — Environment variables

```bash
openssl rand -hex 32                              # generate a real token

vercel env add CONTROL_PLANE_TOKEN production
vercel env add CONTROL_PLANE_TOKEN preview
vercel env add DATABASE_URL production            # from Step 1
vercel env add GITHUB_DISPATCH_TOKEN production   # lets the form start provisioning
vercel env add PLATFORM_REPO production           # chaumn16/trashlab-platform
```

| Variable | Required | Notes |
|---|---|---|
| `CONTROL_PLANE_TOKEN` | **yes** | bearer token tenant CI presents. Must match the `CONTROL_PLANE_TOKEN` secret in every tenant repo |
| `DATABASE_URL` | **yes in production** | Step 1. Unset ⇒ writes are lost between requests |
| `GITHUB_DISPATCH_TOKEN` | for provisioning | fine-grained PAT, *Contents: read and write* on the platform repo only |
| `PLATFORM_REPO` | for provisioning | which repo's `provision-tenant` workflow the form triggers |

**`CONTROL_PLANE_TOKEN` fails closed.** Unset, every API route returns `503` —
never an open endpoint. The dashboard still renders, which is the usual way to
end up with a half-configured deployment that looks fine.

**`GITHUB_DISPATCH_TOKEN` is deliberately weak.** It triggers a workflow; it does
not provision — see [Step 8](#step-8--the-provisioning-workflow).

Leave `GITHUB_DISPATCH_TOKEN` unset and the console still works: requests are
validated and listed, but nothing is dispatched.

---

## Step 4 — Deploy

```bash
vercel --prod
vercel domains add trashlab-control-plane.vercel.app
```

---

## Step 5 — Verify

Run all five. Each catches a different half-configured state, and the last one is
the only one that proves the database is actually wired up.

```bash
CP=https://trashlab-control-plane.vercel.app
T=<the token from Step 3>
```

**1. The dashboard renders**

```bash
curl -s -o /dev/null -w "%{http_code}\n" $CP/          # 200
```

**2. Auth is enforced — and the code tells you which thing is missing**

```bash
curl -s -o /dev/null -w "%{http_code}\n" $CP/api/tenants
```

`401` is correct. **`503` means `CONTROL_PLANE_TOKEN` is not set** — the app is
refusing rather than serving openly.

**3. The fleet reads back**

```bash
curl -s -H "Authorization: Bearer $T" $CP/api/tenants | head -c 200
```

**4. A callback is accepted**

```bash
curl -s -X POST $CP/api/ci-result \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"tenantId":"globex","sha":"deadbeef","status":"success"}'
# {"ok":true}
```

**5. It survived — the one that matters**

Reload the dashboard. The event from step 4 must be listed under *Recent CI and
deploy events*.

If it is not, `DATABASE_URL` is not reaching the deployment and you are on the
in-memory path. Everything above passes on a control plane that forgets every
write, which is why this check exists.

---

## Step 6 — Put it behind SSO

`/tenants/new` creates customers and `/` lists every one of them. **Neither page
is token-protected** — they are human UI, and a bearer token in a browser is not
authentication. The token guards the API, not the pages.

Vercel: **Project Settings → Deployment Protection → Vercel Authentication**. Or
put your own IdP in front.

Do this before sharing the URL with anyone, including sales.

---

## Step 7 — Point tenants at it

Each tenant repo needs these; `platform tenant add` sets them at provisioning:

```bash
gh variable set CONTROL_PLANE_URL   --body "https://trashlab-control-plane.vercel.app" --repo trashlab/tenant-globex
gh secret   set CONTROL_PLANE_TOKEN --body "$T"                           --repo trashlab/tenant-globex
```

Reporting is deliberately **best-effort** — both workflows end their curl with
`|| true`. A control-plane outage should degrade fleet visibility, never fail a
tenant's deploy.

---

## Step 8 — The provisioning workflow

The console does **not** provision. The Add-tenant form validates the request and
dispatches
[`.github/workflows/provision-tenant.yml`](../.github/workflows/provision-tenant.yml),
which runs `platform tenant add --apply`.

Three reasons, worth understanding before anyone "simplifies" it:

1. **Provisioning takes minutes** — repo, database, project, domain, deploy.
   Serverless functions time out; a workflow does not.
2. **Blast radius.** `VERCEL_TOKEN` and the fleet GitHub token can create repos
   and deploy anywhere in the fleet. A sales-facing web app is the wrong place to
   keep them. The console holds only the weak dispatch token from Step 3.
3. **Retry and audit for free.** "Who onboarded this customer, and when" is
   answerable from the Actions history.

Set these once, on the **platform repo** — not on the Vercel project:

```bash
gh secret   set VERCEL_TOKEN        --repo chaumn16/trashlab-platform
gh secret   set FLEET_GITHUB_TOKEN  --repo chaumn16/trashlab-platform   # repo + workflow scope
gh variable set VERCEL_TEAM_ID      --repo chaumn16/trashlab-platform --body "team_xxxx"
```

The workflow runs `tenant add` as a **dry run first**, then with `--apply`. A bad
slug or a duplicate fails before anything is created — provisioning is far
cheaper to prevent than to unwind.

### Verify it end to end

Submit a tenant at `/tenants/new` with an obviously disposable slug. You should
see a run appear under the platform repo's **Actions** tab within seconds, and
the request listed on the dashboard as `dispatched`.

If the dashboard says **"recorded but not dispatched"**, `GITHUB_DISPATCH_TOKEN`
is unset or lacks *Contents: read and write* on the platform repo.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build: `Module not found: ../../../registry/tenants.json` | "Include source files outside of the Root Directory" is off | turn it on (Step 2) |
| Every API route returns `503` | `CONTROL_PLANE_TOKEN` unset | add it, redeploy |
| API returns `401` with a token you believe is right | token mismatch between the app and the caller | they must be byte-identical |
| Dashboard is fine, but events vanish on reload | `DATABASE_URL` unset — in-memory path | add it (Step 1), redeploy |
| Dashboard is empty | a database that failed to seed | check logs; seeding runs on first request |
| `no pg_hba.conf entry` / SSL errors | Vercel Postgres and Neon require TLS | use the pooled connection string Vercel gives you, unmodified |
| Add-tenant says "recorded but not dispatched" | `GITHUB_DISPATCH_TOKEN` unset | expected locally; add it in production |
| Rebuilds on unrelated pushes | no Ignored Build Step | add the path filter (Step 2) |
| Build log: `fatal: bad revision 'HEAD^'` | Ignored Build Step run against Vercel's shallow clone | use the script or the one-liner in Step 2, which deepen first |
| Build log: `syntax error near unexpected token 'then'` | a multi-line if/then in the Ignored Build Step; Vercel runs it as one line | use `scripts/vercel-ignore-build.sh`, or the single-line form |
| `No Output Directory named "public" found` | Root Directory not set, so Vercel read the workspace root and detected no framework | set Root Directory to `apps/control-plane` (Step 2) |
| Build log: `scripts/vercel-ignore-build.sh: No such file or directory` | the step runs from the Root Directory, not the repo root | invoke via `"$(git rev-parse --show-toplevel)/scripts/…"` (Step 2) |
| Builds stopped happening entirely, no error | cwd-relative pathspec matching nothing, so the filter always says "no changes" | same fix — anchor to the repo root |
| No deployment at all after adding the filter | the head commit did not touch the watched paths | expected — push a change under `apps/control-plane`, or redeploy from the dashboard |

---

## Before real traffic

1. **SSO (Step 6).** It lists every customer and can create more.
2. **Per-tenant tokens.** `lib/auth.ts` checks one shared token. The design calls
   for a token per tenant, so a leak from one repo can only write that tenant's
   status. This is the one place the implementation is weaker than the
   architecture it serves.
3. **Record who requested each tenant.** The console sends
   `requestedBy: "console"` because there is no identity to read yet. Once SSO is
   in front, pass the authenticated user through — provisioning a customer should
   never be anonymous.
