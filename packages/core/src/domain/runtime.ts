import type {
  TenantConfig,
  Job,
  HookContext,
  PriceQuote,
  ValidationResult,
  SlotName,
  SlotContent,
  SlotContext,
  ReadOnlyStore,
} from "../extend/types.js";
import { defaultPricing } from "./pricing.js";

/**
 * The guard layer between core and tenant-authored code.
 *
 * Every call into a tenant hook goes through here. This is the code-level half
 * of the isolation story (the repo boundary is the other half): an AI agent can
 * write a hook that throws, hangs, or returns garbage, and the blast radius is
 * one degraded request for one tenant — never a 500, never a stuck worker,
 * never a page for the core on-call.
 */

const HOOK_TIMEOUT_MS = 2_000;

export interface TenantRuntime {
  config: TenantConfig;
  priceJob(job: Job): Promise<PriceQuote>;
  validateJob(job: Job): Promise<ValidationResult>;
  emitJobCompleted(job: Job): Promise<void>;
  renderSlot(name: SlotName, ctx: SlotContext): SlotContent | null;
  /** Errors thrown by tenant code during this process's lifetime. Surfaced in
   *  the admin UI and shipped to the tenant's own error queue. */
  hookErrors: HookError[];
}

export interface HookError {
  hook: string;
  message: string;
  at: string;
}

export function createRuntime(config: TenantConfig, db: ReadOnlyStore): TenantRuntime {
  const hookErrors: HookError[] = [];

  const ctx: HookContext = {
    tenantId: config.id,
    config,
    db,
    now: () => new Date(),
    log: (msg, meta) => {
      // Routed to the tenant's log stream, tagged so fleet dashboards can slice
      // by tenant and core version.
      console.log(JSON.stringify({ tenant: config.id, src: "tenant-hook", msg, ...meta }));
    },
  };

  function recordError(hook: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    hookErrors.push({ hook, message, at: new Date().toISOString() });
    console.error(
      JSON.stringify({ tenant: config.id, src: "tenant-hook", hook, error: message })
    );
  }

  /** Run a tenant hook with a timeout and a fallback. Never rejects. */
  async function guard<T>(hook: string, fn: () => Promise<T> | T, fallback: T): Promise<T> {
    try {
      const result = await Promise.race([
        Promise.resolve(fn()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`hook exceeded ${HOOK_TIMEOUT_MS}ms`)), HOOK_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch (err) {
      recordError(hook, err);
      return fallback;
    }
  }

  return {
    config,
    hookErrors,

    async priceJob(job: Job): Promise<PriceQuote> {
      const fallback = defaultPricing(job, ctx);
      if (!config.hooks?.price) return fallback;

      const result = await guard("price", () => config.hooks!.price!(job, ctx), fallback);

      // Contract enforcement. A tenant hook that violates the documented
      // contract degrades to core pricing rather than emitting a bad invoice.
      if (!isValidQuote(result)) {
        recordError("price", new Error("returned an invalid PriceQuote; fell back to core pricing"));
        return fallback;
      }
      return result;
    },

    async validateJob(job: Job): Promise<ValidationResult> {
      const core = coreValidate(job);
      if (!core.ok) return core; // Tenant hooks may tighten, never loosen.
      if (!config.hooks?.validateJob) return core;

      return guard("validateJob", () => config.hooks!.validateJob!(job, ctx), { ok: true });
    },

    async emitJobCompleted(job: Job): Promise<void> {
      if (!config.hooks?.onJobCompleted) return;
      await guard("onJobCompleted", () => config.hooks!.onJobCompleted!(job, ctx), undefined);
    },

    renderSlot(name: SlotName, slotCtx: SlotContext): SlotContent | null {
      const renderer = config.slots?.[name];
      if (!renderer) return null;
      try {
        return renderer(slotCtx);
      } catch (err) {
        recordError(`slot:${name}`, err);
        return null; // A broken widget leaves a gap in the page, not a blank page.
      }
    },
  };
}

function isValidQuote(q: PriceQuote): boolean {
  if (!q || typeof q !== "object") return false;
  if (!q.total || typeof q.total.cents !== "number") return false;
  if (!Number.isFinite(q.total.cents) || q.total.cents < 0) return false;
  if (!Array.isArray(q.lineItems)) return false;
  const sum = q.lineItems.reduce((s, li) => s + (li?.amount?.cents ?? NaN), 0);
  // Line items must reconcile to the total, within a cent of rounding slack.
  return Number.isFinite(sum) && Math.abs(sum - q.total.cents) <= 1;
}

/** Core invariants. Not overridable by tenant code. */
function coreValidate(job: Job): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  if (!job.siteId) errors.push({ field: "siteId", message: "required" });
  if (!job.customerId) errors.push({ field: "customerId", message: "required" });
  if (Number.isNaN(Date.parse(job.scheduledFor)))
    errors.push({ field: "scheduledFor", message: "must be a valid ISO 8601 date" });
  if (job.weightLbs != null && job.weightLbs < 0)
    errors.push({ field: "weightLbs", message: "must be non-negative" });
  return errors.length ? { ok: false, errors } : { ok: true };
}
