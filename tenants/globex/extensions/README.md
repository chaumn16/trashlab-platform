# Extensions

Tenant business logic lives here — pricing, validation, slot renderers. Wire
anything you add into `tenant.config.ts` under `hooks` or `slots`.

```ts
import { quote, usd, defaultPricing } from "@trashlab/core/extend";
import type { Job, HookContext, PriceQuote } from "@trashlab/core/extend";

export function price(job: Job, ctx: HookContext): PriceQuote {
  const base = defaultPricing(job, ctx);   // delegate, then adjust
  return quote([...base.lineItems, { label: "Fuel surcharge", amount: usd(12) }]);
}
```

Prefer delegating to `defaultPricing` and adjusting over reimplementing the rate
card — otherwise this tenant drifts from core on every release.

## Where `@trashlab/core` comes from

A **tarball committed to this repo at `../vendor/`**, installed via a `file:`
dependency. There is no package registry: no `npm publish`, no `.npmrc`, no
token. A fresh clone builds with zero platform credentials.

**Do not edit anything in `vendor/`, and do not change the core version.** Both
are CODEOWNERS-protected. The fleet controller swaps the tarball when this tenant
moves to a new core version, in the same commit that updates `package.json` and
`tenant.lock`.

Working on core itself? `npm run link:core` repoints the dependency at a local
checkout of the platform repo; `npm run unlink:core` restores the tarball.

## What you may import

Four entry points, enforced by ESLint (`no-restricted-imports`) and re-checked in
CI:

| Import | Use |
|---|---|
| `@trashlab/core/extend` | **business logic — this is the one you want** |
| `@trashlab/core/app` | mounting core's UI (already wired in `app/`) |
| `@trashlab/core/conformance` | the CI test harness (already wired in `tests/`) |
| `@trashlab/core` | `CORE_VERSION`, `createStore` |

Anything deeper — `@trashlab/core/dist/...`, internals of any kind — fails the
build. Those are not a contract and change without notice. If you need something
that isn't exported from `/extend`, that's a platform request: open an issue
rather than reaching inside.

## The pricing contract

Enforced by the conformance suite on every PR, against edge-case jobs (missing
weight, zero containers, extreme values):

| Rule | Why |
|---|---|
| **Deterministic** | the same job must not re-invoice at a different amount. No `Date.now()`, no `Math.random()`, no mutable module state — use `ctx.now()` if you need the date |
| **Non-negative** | a negative total is a credit nobody authorised |
| **Whole cents** | use `usd()` / `cents()` rather than raw arithmetic |
| **Line items reconcile to the total** | use `quote()`, which derives the total from the line items — this is the single most common bug in tenant pricing |
| **Must not throw** | a throw strands a completed job as un-invoiceable. Return a zero total with an `explain` instead |

If a hook violates the contract at runtime anyway, core logs it to this tenant's
error queue and falls back to default pricing. The request still succeeds, the
page still renders, and core on-call is not paged.
