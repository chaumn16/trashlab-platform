/**
 * The public extension contract.
 *
 * This file is the ENTIRE surface a tenant app may depend on. Everything else in
 * @trashlab/core is an internal implementation detail and may change in any minor
 * release without notice.
 *
 * Adding to this file is a semver-minor. Changing or removing anything here is a
 * semver-major and must ship with a codemod (see docs/RUNBOOK-rollout.md).
 */

// ---------------------------------------------------------------------------
// Domain types (stable)
// ---------------------------------------------------------------------------

export type Money = { cents: number; currency: "USD" };

export type ServiceType = "residential" | "commercial" | "rolloff" | "recycling";

export interface Customer {
  id: string;
  name: string;
  serviceType: ServiceType;
  /** Tenant-defined fields, declared via TenantConfig.customFields.customer */
  custom: Record<string, unknown>;
}

export interface Site {
  id: string;
  customerId: string;
  address: string;
  /** Container count at this site, used by several pricing strategies. */
  containers: number;
}

export type JobStatus = "scheduled" | "en_route" | "completed" | "skipped";

export interface Job {
  id: string;
  siteId: string;
  customerId: string;
  scheduledFor: string; // ISO 8601
  status: JobStatus;
  serviceType: ServiceType;
  /** Net weight in pounds. Present once the truck scales out. */
  weightLbs?: number;
  /** Containers actually serviced. May differ from Site.containers. */
  containersServiced?: number;
  custom: Record<string, unknown>;
}

export interface PriceQuote {
  /** Total charged to the customer. */
  total: Money;
  /** Human-readable breakdown rendered on the invoice. */
  lineItems: Array<{ label: string; amount: Money }>;
  /** Free-form, surfaced in the admin UI for support. Never shown to customers. */
  explain?: string;
}

// ---------------------------------------------------------------------------
// Extension context
// ---------------------------------------------------------------------------

/**
 * Passed to every hook. This is the ONLY way tenant code reaches platform
 * services — there is no ambient import that works. Keeping it explicit is what
 * lets the conformance suite run tenant hooks in a sandbox.
 */
export interface HookContext {
  tenantId: string;
  /** Read-only view of the tenant's own config. */
  config: Readonly<TenantConfig>;
  /** Scoped logger. Output is tagged with tenantId and routed to the tenant's
   *  error queue, never to the core on-call rotation. */
  log: (msg: string, meta?: Record<string, unknown>) => void;
  /** Read-only data access, automatically scoped to this tenant's database. */
  db: ReadOnlyStore;
  /** Wall clock, injectable so conformance tests are deterministic. */
  now: () => Date;
}

export interface ReadOnlyStore {
  getCustomer(id: string): Promise<Customer | null>;
  getSite(id: string): Promise<Site | null>;
  listJobs(filter?: { customerId?: string; status?: JobStatus }): Promise<Job[]>;
}

export interface ValidationResult {
  ok: boolean;
  errors?: Array<{ field: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Hooks — the named extension points
// ---------------------------------------------------------------------------

export interface TenantHooks {
  /**
   * Replace the default pricing strategy.
   *
   * Contract: must be PURE and DETERMINISTIC for a given (job, ctx) pair, must
   * not throw, and must return a non-negative total. The conformance suite
   * enforces all three. If you need to fail, return a zero total and set
   * `explain` — throwing here would strand a completed job as un-invoiceable.
   */
  price?: (job: Job, ctx: HookContext) => Promise<PriceQuote> | PriceQuote;

  /** Extra validation before a job is accepted. Runs AFTER core validation;
   *  it can tighten rules but never loosen them. */
  validateJob?: (job: Job, ctx: HookContext) => Promise<ValidationResult> | ValidationResult;

  /** Fire-and-forget side effects. Errors are logged to the tenant queue and
   *  swallowed — a failing webhook must never block an operator's workflow. */
  onJobCompleted?: (job: Job, ctx: HookContext) => Promise<void> | void;
  onJobScheduled?: (job: Job, ctx: HookContext) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// UI extension
// ---------------------------------------------------------------------------

/** Named regions of the core UI a tenant may inject into. */
export type SlotName =
  | "nav.primary"
  | "dashboard.widgets"
  | "job.detail.sidebar"
  | "invoice.footer";

/** A slot renderer. Kept as a plain function returning a serializable
 *  description rather than a React node, so slots can be rendered by the
 *  conformance suite without a DOM. */
export type SlotRenderer = (ctx: SlotContext) => SlotContent | null;

export interface SlotContext {
  tenantId: string;
  job?: Job;
  customer?: Customer;
}

export type SlotContent =
  | { kind: "text"; value: string }
  | { kind: "stat"; label: string; value: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "rows"; title: string; rows: Array<{ label: string; value: string }> };

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export interface CustomFieldDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "date";
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Tenant configuration
// ---------------------------------------------------------------------------

export interface TenantConfig {
  /** Stable tenant slug. Must match the registry and the Vercel project name. */
  id: string;
  displayName: string;

  /** Core feature toggles. Adding a flag here is always semver-minor. */
  features: {
    invoicing: boolean;
    routeOptimization: boolean;
    customerPortal: boolean;
    weighTickets: boolean;
  };

  theme: {
    brandColor: string;
    logoText: string;
  };

  customFields?: {
    customer?: CustomFieldDef[];
    job?: CustomFieldDef[];
  };

  hooks?: TenantHooks;

  slots?: Partial<Record<SlotName, SlotRenderer>>;

  /** Routes the tenant adds under app/. Declared here so core's nav and the
   *  conformance suite know they exist; the files themselves live in the
   *  tenant repo. */
  customRoutes?: Array<{ path: string; label: string; showInNav?: boolean }>;
}
