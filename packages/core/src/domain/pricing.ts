import type { Job, HookContext, PriceQuote, ServiceType } from "../extend/types.js";
import { usd, addMoney, multiplyMoney } from "../extend/index.js";

/**
 * Platform default rate card. This is what a tenant gets with no pricing hook,
 * and what most tenants delegate to and then adjust.
 *
 * Changing these numbers is a semver-MINOR but a business-breaking one: every
 * tenant on the default sees a price change. Rate card changes therefore ship
 * behind a dated feature flag and a fleet-wide comms step, never silently in a
 * patch. See docs/RUNBOOK-rollout.md.
 */
const BASE_RATE: Record<ServiceType, number> = {
  residential: 28.0,
  commercial: 65.0,
  rolloff: 425.0,
  recycling: 18.5,
};

/** Included tonnage before overage applies, by service type. */
const INCLUDED_LBS: Record<ServiceType, number> = {
  residential: 200,
  commercial: 1000,
  rolloff: 4000,
  recycling: 400,
};

const OVERAGE_PER_LB = 0.045;

export function defaultPricing(job: Job, _ctx: HookContext): PriceQuote {
  const base = usd(BASE_RATE[job.serviceType]);
  const lineItems = [{ label: `${titleCase(job.serviceType)} pickup`, amount: base }];

  const included = INCLUDED_LBS[job.serviceType];
  if (job.weightLbs != null && job.weightLbs > included) {
    const overLbs = job.weightLbs - included;
    lineItems.push({
      label: `Overage (${overLbs.toLocaleString()} lbs @ $${OVERAGE_PER_LB.toFixed(3)}/lb)`,
      amount: usd(overLbs * OVERAGE_PER_LB),
    });
  }

  // Additional containers beyond the first are billed at 60% of base.
  const extra = (job.containersServiced ?? 1) - 1;
  if (extra > 0) {
    lineItems.push({
      label: `${extra} additional container${extra > 1 ? "s" : ""}`,
      amount: multiplyMoney(base, 0.6 * extra),
    });
  }

  return {
    total: addMoney(...lineItems.map((li) => li.amount)),
    lineItems,
    explain: "core default rate card v4",
  };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
