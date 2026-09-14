# Architecture

## The problem

Deploying one bespoke app is easy. The hard problem at ~2,000 tenants is **fleet
operations**: shipping a core security fix across 2,000 divergent deployments
without a three-week manual campaign, and knowing which forty of them broke.

Every decision here optimizes for that. The failure mode on one side is 2,000
forks. The failure mode on the other is "config flags only," which doesn't
deliver bespoke. This is the middle path.

---

## 1. System topology

One core package, consumed by many independent tenant repos, each deploying to
its own isolated runtime and database.

```mermaid
flowchart TB
    subgraph CP["Control plane"]
        REG[("Tenant registry<br/>version · channel · health")]
        CLI["platform CLI<br/>add · deploy · rollout"]
        CLI <--> REG
    end

    subgraph PLAT["Platform repo — chaumn16/trashlab-platform"]
        CORE["@trashlab/core<br/>domain · UI · extension API"]
        TPL["tenant-starter template"]
    end

    PKG[["GitHub Release asset<br/>trashlab-core-4.2.3.tgz<br/><i>no registry</i>"]]
    CORE -->|npm pack| PKG

    subgraph TENANTS["Tenant repos — one per customer"]
        direction LR
        R1["tenant-acme<br/><i>config only</i>"]
        R2["tenant-globex<br/><i>custom pricing</i>"]
        R3["tenant-…<br/>× 2,000"]
    end

    PKG -.->|vendored into vendor/| R1 & R2 & R3
    TPL -->|scaffolds| TENANTS
    CLI -->|provision · bump · deploy| TENANTS

    subgraph RUNTIME["Runtime — dedicated per tenant"]
        direction LR
        V1["Vercel project<br/>acme.trashlab.app"]
        V2["Vercel project<br/>globex.trashlab.app"]
        V3["Vercel project<br/>…"]
    end

    R1 --> V1
    R2 --> V2
    R3 --> V3

    V1 --> D1[("Postgres<br/>tenant-acme")]
    V2 --> D2[("Postgres<br/>tenant-globex")]
    V3 --> D3[("Postgres<br/>…")]
```

**Isolation comes from the connection string, not a `WHERE` clause.** Each Vercel
project holds only its own `DATABASE_URL`, so cross-tenant leakage is
structurally impossible rather than a code-review responsibility.

### Three layers, decided separately

| Layer | Choice | Why |
|---|---|---|
| **Code** | Shared core as a semver'd tarball, vendored per-tenant repo | One place to fix bugs; divergence contained in small reviewable surfaces; tenant repos need zero platform credentials |
| **Runtime** | Dedicated Vercel project per tenant | Blast radius, per-tenant rollback, required once core logic actually differs |
| **Data** | Dedicated Postgres per tenant | Tenants on different core versions can't share a schema |

---

## 2. What lives where

The whole app is core. A tenant repo is a thin shell that mounts it and injects
differences at named points.

```mermaid
flowchart LR
    subgraph T["tenant-globex repo (~24 files)"]
        direction TB
        CFG["tenant.config.ts<br/><i>features · theme · wiring</i>"]
        EXT["extensions/<br/><i>pricing · validation · slots</i>"]
        APPT["app/manifests/<br/><i>custom route</i>"]
        MIG["migrations/<br/><i>t_ prefixed tables</i>"]
        MOUNT["app/[[...slug]]/page.tsx<br/><i>2-line mount</i>"]
        LOCK["tenant.lock 🔒<br/>.github/ 🔒<br/>package.json 🔒"]
    end

    subgraph C["@trashlab/core (pinned package)"]
        direction TB
        EXTEND["/extend<br/><b>the public contract</b>"]
        APP["/app<br/>CoreApp · CoreLayout"]
        CONF["/conformance<br/>CI gate"]
        INT["internals<br/>runtime · db · domain"]
    end

    CFG --> EXTEND
    EXT --> EXTEND
    MOUNT --> APP
    APPT --> APP
    T -.->|"❌ blocked by ESLint"| INT

    style INT fill:#fee,stroke:#b42318
    style EXTEND fill:#e8f5e9,stroke:#0f5132
    style LOCK fill:#f5f5f5,stroke:#999
```

🔒 = protected by `CODEOWNERS`. An agent working in a tenant repo can write
business logic freely but cannot change its own core version, edit CI, or reach
deploy secrets.

### Core owns invariants. Tenants own decisions.

| Core — never overridable | Tenant-owned |
|---|---|
| authn / authz, tenant identity | branding, theme |
| billing, audit log | custom fields and entities |
| data access layer, migration engine | business rules at named extension points |
| observability, version badge | custom pages and reports |
| API contracts, security controls | integrations, notification workflows |

---

## 3. The four enforcement layers

Convention doesn't survive 2,000 repos and AI-authored code. Each boundary is
mechanically enforced.

```mermaid
flowchart TB
    AGENT["AI agent writes<br/>tenant code"] --> PR["Pull request"]

    PR --> L1{"① Import boundary<br/><i>ESLint</i>"}
    L1 -->|reached into core internals| X1["❌ build fails"]
    L1 -->|ok| L2{"② Conformance suite<br/><i>core contract</i>"}
    L2 -->|"non-deterministic · negative<br/>total · items don't reconcile"| X2["❌ build fails"]
    L2 -->|ok| L3{"③ CODEOWNERS<br/><i>branch protection</i>"}
    L3 -->|touched tenant.lock or CI| X3["❌ needs platform review"]
    L3 -->|ok| MERGE["Merge → deploy<br/><i>this tenant only</i>"]

    MERGE --> PROD["Production"]
    PROD --> L4{"④ Runtime guard<br/><i>timeout + fallback</i>"}
    L4 -->|hook throws / hangs / returns junk| FALL["⚠ fall back to core behaviour<br/>log to tenant error queue<br/><b>request still succeeds</b>"]
    L4 -->|ok| OK["✓ tenant logic applied"]

    style X1 fill:#fee,stroke:#b42318
    style X2 fill:#fee,stroke:#b42318
    style X3 fill:#fee,stroke:#b42318
    style FALL fill:#fff8e1,stroke:#b45309
    style OK fill:#e8f5e9,stroke:#0f5132
```

**Layers ② and ④ are deliberately different.** The runtime guard is the
production net and fails *soft* — a broken hook degrades to core behaviour rather
than 500ing. The conformance suite probes hooks *directly* so CI reports exactly
which rule broke; running CI through the guard would report every distinct bug as
the same opaque "invalid quote".

---

## 4. A priced request, end to end

```mermaid
sequenceDiagram
    participant U as Operator
    participant N as Next.js (tenant app)
    participant CA as CoreApp
    participant RT as Runtime guard
    participant TH as Tenant price hook
    participant DB as Tenant Postgres

    U->>N: GET /jobs/job_1003
    N->>CA: mount with tenant.config
    CA->>DB: getJob · getCustomer · getSite
    DB-->>CA: rows
    CA->>RT: priceJob(job)

    alt no tenant hook
        RT->>RT: defaultPricing() — core rate card
    else tenant hook present
        RT->>TH: price(job, ctx) with 2s timeout
        alt returns a valid quote
            TH-->>RT: PriceQuote
            RT->>RT: validate: finite · non-negative<br/>line items reconcile
        else throws, hangs, or malformed
            TH--xRT: ✗
            RT->>RT: log to tenant queue<br/>fall back to defaultPricing()
        end
    end

    RT-->>CA: PriceQuote
    CA->>RT: renderSlot("job.detail.sidebar")
    RT-->>CA: SlotContent (serializable, not JSX)
    CA-->>U: rendered page
```

Slots return a **serializable description, not JSX**, so core controls the markup.
An agent cannot inject arbitrary DOM or scripts into the admin shell.

---

## 5. Extension points

Defined in `packages/core/src/extend/types.ts`. That file is the entire surface
tenants may depend on. Adding to it is semver-minor; changing it is semver-major
and must ship with a codemod.

| Point | Contract |
|---|---|
| `hooks.price` | Deterministic, non-negative, must not throw; line items reconcile to total |
| `hooks.validateJob` | May **tighten** core validation, never loosen it |
| `hooks.onJobCompleted` / `onJobScheduled` | Fire-and-forget; errors swallowed to the tenant queue |
| `slots` | Named UI regions; return serializable content, not JSX |
| `customRoutes` | Ordinary Next.js routes; Next resolves them before core's catch-all |
| `customFields` | Tenant-declared fields, stored in the tenant's own database |

### The closed import boundary

Four public entry points, everything else internal:

| Allowed | Purpose |
|---|---|
| `@trashlab/core` | `CORE_VERSION`, `createStore` |
| `@trashlab/core/extend` | business logic — hooks, slots, types, money helpers |
| `@trashlab/core/app` | the mount — `CoreApp`, `CoreLayout` |
| `@trashlab/core/conformance` | the CI test harness |

Anything under `/dist`, `/src`, or any other subpath fails the build. Without
this, one agent reaching into core internals turns every core refactor into a
fleet-wide breaking change.

---

> The process around this — triage, gates, review, release, incident response —
> is documented in [SDLC.md](SDLC.md).

## 6. The convergence loop

The mechanism that stops 2,000 tenants becoming 2,000 codebases.

```mermaid
flowchart LR
    REQ["Customer request"] --> T{"Triage"}
    T -->|config| CFG["Toggle in console<br/><i>seconds, no deploy</i>"]
    T -->|extension point| OV["Write overlay<br/><i>PR + preview deploy</i>"]
    T -->|neither| ESC{"Escalate"}

    ESC -->|preferred| NEW["Add extension point to core<br/><i>semver-minor</i>"]
    ESC -->|last resort| EJECT["Eject to fork<br/><i>VP sign-off + written reason</i>"]

    OV --> COUNT{"≥3 tenants with<br/>the same hook?"}
    COUNT -->|yes| PROMOTE["Promote into core<br/>as config-driven feature"]
    PROMOTE --> SHRINK["Their overlays shrink"]
    COUNT -->|no| KEEP["Stays in the overlay"]

    EJECT --> PM["Post-mortem:<br/>which extension point<br/>was missing?"]
    PM --> NEW

    style PROMOTE fill:#e8f5e9,stroke:#0f5132
    style EJECT fill:#fee,stroke:#b42318
```

> When **three or more** tenants implement the same hook, promote it into core as
> a config-driven feature and shrink their overlays.

Tracked alongside **eject debt**. Platform health is measured by whether overlays
are *shrinking*, not by how many exist.

---

## 7. Versioning and rollout

- **The pin is the vendored tarball** — the exact bytes live in the tenant repo
  at `vendor/`, referenced by `package.json` as a `file:` dependency.
  Reproducible, credential-free, and rollback is a file swap.
- **The channel is a policy** — how fast the fleet controller may move that pin.

Tenants don't move pins; the controller does. A `pinned` tenant must carry an
**expiry date**, or you accumulate tenants on three-year-old core that nobody can
support.

```mermaid
flowchart TB
    PUB["release core 4.3.0<br/><i>tarball, no registry</i>"] --> CAN["canary<br/><i>internal + ~5 friendly tenants</i>"]
    CAN --> GATE1{"health gate<br/>30 min"}
    GATE1 -->|breach| HALT["⛔ halt rollout<br/><i>deployed batches stay up</i>"]
    GATE1 -->|pass| BETA["beta — 5% batches"]
    BETA --> GATE2{"health gate"}
    GATE2 -->|breach| HALT
    GATE2 -->|pass| STABLE["stable — 10% batches"]

    STABLE --> SPLIT{"hasCustomCode?"}
    SPLIT -->|no| AUTO["auto-merge on green<br/><i>~70% of fleet</i>"]
    SPLIT -->|yes| REVIEW["PR for review<br/><i>owning engineer</i>"]

    AUTO --> CI{"CI: boundary · types<br/>conformance · build"}
    REVIEW --> CI
    CI -->|red| PARK["park on current version<br/>file ticket with diff<br/><b>rollout continues</b>"]
    CI -->|green| DEP["migrate → deploy → smoke test"]

    style HALT fill:#fee,stroke:#b42318
    style PARK fill:#fff8e1,stroke:#b45309
    style AUTO fill:#e8f5e9,stroke:#0f5132
```

**One tenant's failure never blocks the fleet.** A red CI run parks that tenant,
files a ticket, and the rollout continues. Stragglers are chased asynchronously.

**Config-only tenants auto-merge; custom-code tenants get a PR.** This split is
what keeps a 2,000-tenant rollout from needing 2,000 humans.

Migrations are **expand/contract**, always — a migration that makes the previous
build fail is a rollback you cannot perform. Details in
[`RUNBOOK-rollout.md`](RUNBOOK-rollout.md).

---

## 8. Tenant lifecycle

```mermaid
stateDiagram-v2
    [*] --> Provisioning: platform tenant add
    Provisioning --> ConfigOnly: repo · db · project · domain · deploy
    note right of Provisioning
        7 automated steps, ~4 min
        idempotent and resumable
        triggered by sales, not engineering
    end note

    ConfigOnly --> ConfigOnly: toggle features/theme<br/>(no deploy)
    ConfigOnly --> Custom: first overlay code<br/>platform tenant customize

    Custom --> Custom: agent/engineer PR<br/>preview deploy → merge
    Custom --> ConfigOnly: overlay removed<br/>(back to unattended upgrades)

    ConfigOnly --> Ejected: extension API insufficient
    Custom --> Ejected: extension API insufficient
    note right of Ejected
        VP sign-off required
        post-mortem feeds
        the convergence loop
    end note

    Ejected --> [*]
    ConfigOnly --> [*]: offboard
    Custom --> [*]: offboard
```

---

## 9. Known trade-offs

- **Repo-per-tenant makes fleet codemods harder than a monorepo.** Accepted
  deliberately: the repo boundary is what bounds an AI agent, and it buys
  per-tenant access control, deploy credentials, and audit trail. The cost is
  that fleet tooling is day-one infrastructure, not a later optimization.
- **2,000 repos means 2,000 CI runs per core release.** Mitigated by a hard
  2-second budget on the conformance suite, aggressive caching, and skipping
  repos whose pin didn't change. **Build concurrency on Vercel is the real
  ceiling** — it directly sets your CVE-patch SLA. Negotiate that number before
  the fleet passes ~400.
- **All tenants are dedicated today.** Cost is explicitly not a concern yet. The
  registry still carries `tier`, because pooling config-only tenants is the
  obvious lever when spend starts to matter — `hasCustomCode` already identifies
  the ~70% that could share a runtime.
- **The in-memory store is a demo affordance.**
  `packages/core/src/db/store.ts` marks the Postgres swap point.
