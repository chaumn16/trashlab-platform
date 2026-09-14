import type { TenantConfig, Job, SlotName, SlotContent, PriceQuote, HookContext } from "../extend/types.js";
import { createRuntime } from "../domain/runtime.js";
import { createStore } from "../db/store.js";

/**
 * The core conformance suite.
 *
 * Every tenant repo runs this in CI on every PR and on every core version bump.
 * It is the contract test that makes agent-authored tenant code safe to merge:
 * an agent can write whatever it likes inside extensions/, but it cannot ship
 * code that violates a core invariant.
 *
 * Hard budget: this suite must stay under 2 seconds. It runs ~2,000 times on
 * every core release, and its runtime is a direct multiplier on how fast we can
 * patch the fleet. Adding a slow check here is a fleet-wide regression.
 */

export interface ConformanceFailure {
  check: string;
  detail: string;
}

export interface ConformanceReport {
  tenantId: string;
  passed: boolean;
  checks: number;
  failures: ConformanceFailure[];
}

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** Ambient environments the determinism probe samples across. */
const AMBIENT_ENVS = [
  { now: 1_767_225_600_000, random: 0.1 }, // even ms
  { now: 1_767_312_000_001, random: 0.9 }, // odd ms, next day
  { now: 2_082_758_400_001, random: 0.5 }, // far future
];

/** Edge-case jobs every tenant pricing hook must survive. */
function probeJobs(): Job[] {
  const base: Omit<Job, "id"> = {
    siteId: "site_1", customerId: "cus_1",
    scheduledFor: "2026-09-15T07:30:00Z", status: "completed",
    serviceType: "commercial", custom: {},
  };
  return [
    { ...base, id: "probe_typical", weightLbs: 1200, containersServiced: 2 },
    { ...base, id: "probe_no_weight" },                                  // truck never scaled
    { ...base, id: "probe_zero_weight", weightLbs: 0 },
    { ...base, id: "probe_zero_containers", containersServiced: 0 },
    { ...base, id: "probe_huge", weightLbs: 9_999_999, containersServiced: 500 },
    { ...base, id: "probe_residential", serviceType: "residential", weightLbs: 180 },
    { ...base, id: "probe_rolloff", serviceType: "rolloff", weightLbs: 6000 },
    { ...base, id: "probe_recycling", serviceType: "recycling", weightLbs: 700 },
  ];
}

export async function runConformance(config: TenantConfig): Promise<ConformanceReport> {
  const failures: ConformanceFailure[] = [];
  let checks = 0;
  const fail = (check: string, detail: string) => failures.push({ check, detail });
  const store = createStore();
  const runtime = createRuntime(config, store);

  // Minimal context for probing hooks directly. Mirrors what createRuntime
  // builds, with a frozen clock so determinism checks are meaningful.
  const ctx: HookContext = {
    tenantId: config.id,
    config,
    db: store,
    now: () => new Date("2026-01-01T00:00:00Z"),
    log: () => {},
  };

  // --- config shape -------------------------------------------------------
  checks++;
  if (!SLUG.test(config.id)) {
    fail("config.id", `"${config.id}" must be a lowercase slug (matches the Vercel project and registry key)`);
  }
  checks++;
  if (!config.displayName?.trim()) fail("config.displayName", "must be non-empty");
  checks++;
  if (!/^#[0-9a-fA-F]{6}$/.test(config.theme?.brandColor ?? "")) {
    fail("config.theme.brandColor", `expected a 6-digit hex color, got "${config.theme?.brandColor}"`);
  }

  // --- custom field declarations -----------------------------------------
  for (const [entity, defs] of Object.entries(config.customFields ?? {})) {
    const keys = new Set<string>();
    for (const d of defs ?? []) {
      checks++;
      if (keys.has(d.key)) fail(`customFields.${entity}`, `duplicate key "${d.key}"`);
      keys.add(d.key);
      checks++;
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(d.key)) {
        fail(`customFields.${entity}`, `key "${d.key}" must be a camelCase identifier`);
      }
    }
  }

  // --- custom routes ------------------------------------------------------
  const seenPaths = new Set<string>();
  const RESERVED = ["/", "/jobs", "/customers", "/invoices", "/api"];
  for (const r of config.customRoutes ?? []) {
    checks++;
    if (!r.path.startsWith("/")) fail("customRoutes", `path "${r.path}" must start with /`);
    checks++;
    if (seenPaths.has(r.path)) fail("customRoutes", `duplicate path "${r.path}"`);
    seenPaths.add(r.path);
    checks++;
    if (RESERVED.includes(r.path)) {
      fail("customRoutes", `path "${r.path}" is reserved by core and cannot be overridden`);
    }
  }

  // --- pricing hook contract ---------------------------------------------
  //
  // Deliberately calls the tenant hook DIRECTLY rather than through
  // createRuntime(). The runtime guard is the production safety net: it catches
  // a bad quote and silently falls back to core pricing so the request still
  // succeeds. That is exactly wrong for CI — it would report every distinct bug
  // as the same opaque "invalid PriceQuote". Probing the raw hook is what lets
  // this suite tell an agent precisely which rule it broke.
  if (config.hooks?.price) {
    for (const job of probeJobs()) {
      let samples: PriceQuote[];
      try {
        // Sample under two DIFFERENT ambient environments rather than twice in
        // a row. Back-to-back calls land in the same millisecond, so a hook
        // reading the clock — the most common agent mistake — would pass as
        // deterministic by luck. Moving the clock a day and swapping the RNG
        // makes the check deterministic instead of probabilistic.
        // Three environments spanning both clock parities and a far-future
        // date. `Date.now() % 2` is a real pattern in generated code and would
        // survive any two same-parity samples.
        samples = [];
        for (const env of AMBIENT_ENVS) {
          samples.push(await withAmbient(env, () => config.hooks!.price!(job, ctx)));
        }
      } catch (err) {
        checks++;
        fail("hooks.price", `${job.id}: threw ${err instanceof Error ? err.message : String(err)} — pricing hooks must not throw; return a zero total with an \`explain\` instead`);
        continue;
      }

      const q1 = samples[0];

      checks++;
      if (!q1 || typeof q1 !== "object" || !q1.total || !Array.isArray(q1.lineItems)) {
        fail("hooks.price", `${job.id}: did not return a PriceQuote — use quote() from @trashlab/core/extend`);
        continue;
      }
      checks++;
      if (!Number.isFinite(q1.total.cents)) {
        fail("hooks.price", `${job.id}: total is not a finite number (${q1.total.cents})`);
        continue;
      }
      checks++;
      if (q1.total.cents < 0) {
        fail("hooks.price", `${job.id}: negative total (${q1.total.cents} cents)`);
      }
      checks++;
      if (!Number.isInteger(q1.total.cents)) {
        fail("hooks.price", `${job.id}: total must be whole cents, got ${q1.total.cents} — build the quote with usd()/cents() instead of raw arithmetic`);
      }
      checks++;
      const sum = q1.lineItems.reduce((s, li) => s + (li?.amount?.cents ?? NaN), 0);
      if (!Number.isFinite(sum) || Math.abs(sum - q1.total.cents) > 1) {
        fail("hooks.price", `${job.id}: line items sum to ${sum} but total is ${q1.total.cents} — use quote(), which derives the total from the line items`);
      }
      checks++;
      if (new Set(samples.map((q) => JSON.stringify(q))).size > 1) {
        fail(
          "hooks.price",
          `${job.id}: not deterministic — the same job priced differently when the clock and RNG changed. ` +
            `Pricing must not read Date.now(), Math.random(), or mutable module state, or the same job ` +
            `re-invoices at a different amount. Use ctx.now() if you genuinely need the date.`
        );
      }
      checks++;
      if (q1.lineItems.length === 0) {
        fail("hooks.price", `${job.id}: returned no line items; the invoice would render blank`);
      }
    }
  }

  // --- validation may tighten, never loosen ------------------------------
  checks++;
  const invalid = { ...probeJobs()[0], siteId: "", customerId: "" } as Job;
  const v = await runtime.validateJob(invalid);
  if (v.ok) {
    fail("hooks.validateJob", "a job missing siteId and customerId was accepted; core invariants cannot be loosened");
  }

  // --- slots --------------------------------------------------------------
  const KINDS = new Set(["text", "stat", "link", "rows"]);
  for (const name of Object.keys(config.slots ?? {}) as SlotName[]) {
    const out = runtime.renderSlot(name, { tenantId: config.id, job: probeJobs()[0] });
    checks++;
    if (out !== null && !KINDS.has((out as SlotContent).kind)) {
      fail(`slots.${name}`, `returned unknown content kind "${(out as SlotContent)?.kind}"`);
    }
  }

  // --- nothing may have thrown -------------------------------------------
  checks++;
  for (const e of runtime.hookErrors) {
    fail(`hook-error:${e.hook}`, e.message);
  }

  return { tenantId: config.id, passed: failures.length === 0, checks, failures };
}


/**
 * Runs `fn` with Date.now() and Math.random() pinned to fixed values, then
 * restores them. Lets the determinism check distinguish "depends on its inputs"
 * from "depends on the ambient environment" without waiting on wall-clock time.
 */
async function withAmbient<T>(
  env: { now: number; random: number },
  fn: () => Promise<T> | T
): Promise<T> {
  const realNow = Date.now;
  const realRandom = Math.random;
  Date.now = () => env.now;
  Math.random = () => env.random;
  try {
    return await fn();
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
}

/**
 * node:test adapter. Tenant repos use this so failures land as individual named
 * test cases in CI output rather than one opaque assertion.
 *
 *   import { test } from "node:test";
 *   import { conformanceTests } from "@trashlab/core/conformance";
 *   import tenant from "../tenant.config.js";
 *   conformanceTests(test, tenant);
 */
export function conformanceTests(
  test: (name: string, fn: () => void | Promise<void>) => void,
  config: TenantConfig
): void {
  test(`[conformance] ${config.id} satisfies the core contract`, async () => {
    const report = await runConformance(config);
    if (!report.passed) {
      const lines = report.failures.map((f) => `  ✗ ${f.check}: ${f.detail}`).join("\n");
      throw new Error(
        `${report.failures.length} of ${report.checks} conformance checks failed:\n${lines}\n\n` +
          `See https://github.com/chaumn16/trashlab-platform/blob/main/docs/extend for the contract.`
      );
    }
  });
}
