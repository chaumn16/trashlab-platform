/**
 * @trashlab/core/extend — the only import path tenant apps are permitted to use.
 *
 * Enforced by an ESLint rule in the tenant template (no-restricted-imports) and
 * re-checked in CI by the conformance suite. Deep imports into @trashlab/core/*
 * fail the build.
 */

export type {
  Money,
  ServiceType,
  Customer,
  Site,
  Job,
  JobStatus,
  PriceQuote,
  HookContext,
  ReadOnlyStore,
  ValidationResult,
  TenantHooks,
  SlotName,
  SlotRenderer,
  SlotContext,
  SlotContent,
  CustomFieldDef,
  TenantConfig,
} from "./types.js";

import type { TenantConfig, Money, PriceQuote } from "./types.js";

/**
 * Declare a tenant app. Identity function at runtime; its job is to pin the
 * config to the TenantConfig type so a typo in a feature flag is a build error
 * in the tenant's CI rather than a 500 in production.
 */
export function defineTenant(config: TenantConfig): TenantConfig {
  return config;
}

// ---------------------------------------------------------------------------
// Money helpers. Tenant pricing code does arithmetic constantly; giving it
// correct primitives is cheaper than reviewing 2,000 float bugs.
// ---------------------------------------------------------------------------

export function usd(dollars: number): Money {
  return { cents: Math.round(dollars * 100), currency: "USD" };
}

export function cents(n: number): Money {
  return { cents: Math.round(n), currency: "USD" };
}

export function addMoney(...amounts: Money[]): Money {
  return { cents: amounts.reduce((sum, m) => sum + m.cents, 0), currency: "USD" };
}

export function multiplyMoney(m: Money, factor: number): Money {
  return { cents: Math.round(m.cents * factor), currency: "USD" };
}

export function formatMoney(m: Money): string {
  const sign = m.cents < 0 ? "-" : "";
  const abs = Math.abs(m.cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Build a quote from line items. Prefer this over constructing PriceQuote by
 * hand — it guarantees total always equals the sum of line items, which is the
 * single most common bug in tenant-authored pricing.
 */
export function quote(
  lineItems: Array<{ label: string; amount: Money }>,
  explain?: string
): PriceQuote {
  return { total: addMoney(...lineItems.map((li) => li.amount)), lineItems, explain };
}

/**
 * Re-export of the platform default pricing, so a tenant hook can delegate to
 * core behaviour and then adjust — the common case — instead of reimplementing
 * the base rate card and drifting from it on every core release.
 *
 *   price: (job, ctx) => {
 *     const base = defaultPricing(job, ctx);
 *     return quote([...base.lineItems, { label: "Fuel surcharge", amount: ... }]);
 *   }
 */
export { defaultPricing } from "../domain/pricing.js";

