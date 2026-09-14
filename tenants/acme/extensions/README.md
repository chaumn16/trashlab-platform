# Extensions

Tenant business logic lives here. Import **only** from `@trashlab/core/extend` —
the ESLint config fails the build on anything else.

    import { quote, usd, defaultPricing } from "@trashlab/core/extend";
    import type { Job, HookContext, PriceQuote } from "@trashlab/core/extend";

    export function price(job: Job, ctx: HookContext): PriceQuote {
      const base = defaultPricing(job, ctx);
      return quote([...base.lineItems, { label: "Fuel surcharge", amount: usd(12) }]);
    }

Wire it up in `tenant.config.ts` under `hooks`.

## Contract

Pricing hooks must be **deterministic**, **non-negative**, and **must not throw**.
The conformance suite enforces all three against edge-case jobs (missing weight,
zero containers, extreme values). If a hook violates the contract at runtime,
core logs it to this tenant's error queue and falls back to default pricing —
the request still succeeds.
