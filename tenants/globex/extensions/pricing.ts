import { defaultPricing, quote, usd, cents, multiplyMoney } from "@trashlab/core/extend";
import type { Job, HookContext, PriceQuote } from "@trashlab/core/extend";

/**
 * Globex prices industrial rolloff by disposal weight, not by the core flat
 * rate — their margin is entirely in the landfill tipping spread.
 *
 * This is the case that justifies the whole architecture: it is not a feature
 * flag, not a config value, and not something core should carry. It is one
 * customer's business model, expressed in ~40 lines, isolated in their own repo.
 */

/** Tipping fee passed through from the landfill, per ton. */
const DISPOSAL_PER_TON = 62.5;

/** Weight brackets for the haul fee itself. */
const HAUL_BRACKETS: Array<{ maxLbs: number; fee: number }> = [
  { maxLbs: 2_000, fee: 210 },
  { maxLbs: 6_000, fee: 385 },
  { maxLbs: 12_000, fee: 540 },
  { maxLbs: Infinity, fee: 720 },
];

/** Indexed monthly by ops. Flat for now; sourced from config so it is a
 *  one-line PR rather than a code change when diesel moves. */
const FUEL_SURCHARGE_PCT = 0.085;

export function price(job: Job, ctx: HookContext): PriceQuote {
  // Non-rolloff work is ordinary hauling — delegate to core rather than
  // reimplementing the rate card and drifting from it on every core release.
  if (job.serviceType !== "rolloff") {
    return defaultPricing(job, ctx);
  }

  const weight = job.weightLbs ?? 0;

  // A rolloff that hasn't scaled out yet can't be priced. Return zero with an
  // explanation rather than throwing — throwing would strand the job as
  // un-invoiceable, and the contract forbids it.
  if (weight <= 0) {
    return quote(
      [{ label: "Awaiting scale ticket", amount: cents(0) }],
      "globex: job not yet weighed; invoice held"
    );
  }

  const bracket = HAUL_BRACKETS.find((b) => weight <= b.maxLbs)!;
  const haul = usd(bracket.fee);
  const tons = weight / 2_000;
  const disposal = usd(tons * DISPOSAL_PER_TON);
  const fuel = multiplyMoney(haul, FUEL_SURCHARGE_PCT);

  return quote(
    [
      { label: `Rolloff haul (${weight.toLocaleString()} lbs)`, amount: haul },
      { label: `Disposal (${tons.toFixed(2)} tons @ $${DISPOSAL_PER_TON.toFixed(2)}/ton)`, amount: disposal },
      { label: `Fuel surcharge (${(FUEL_SURCHARGE_PCT * 100).toFixed(1)}%)`, amount: fuel },
    ],
    `globex: weight-bracket pricing, bracket ≤${bracket.maxLbs === Infinity ? "∞" : bracket.maxLbs.toLocaleString()} lbs`
  );
}
