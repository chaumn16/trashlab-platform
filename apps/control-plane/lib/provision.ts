import { readTenants } from "./registry";
import { recordRequestDb, readRequestsDb, type Queryable } from "./db";
import { PLANS, REGIONS } from "./plans";

/**
 * Tenant provisioning requests.
 *
 * ┌─ WHY THIS DOESN'T PROVISION INLINE ─────────────────────────────────────┐
 * │ The console does NOT hold VERCEL_TOKEN or GITHUB_TOKEN, and does not run │
 * │ provisioning itself. It validates the request, records it, and dispatches │
 * │ a GitHub Actions workflow that runs `platform tenant add --apply`.        │
 * │                                                                          │
 * │ Three reasons:                                                           │
 * │  1. Provisioning takes minutes (repo, database, project, domain, deploy). │
 * │     Serverless functions time out; a workflow does not.                  │
 * │  2. Those two tokens can create repos and deploy anywhere in the fleet.   │
 * │     A sales-facing web app is the wrong blast radius for them — they      │
 * │     belong in GitHub secrets, reachable only by the workflow.            │
 * │  3. Workflows give retry and an audit trail for free. "Who provisioned    │
 * │     this tenant and when" is a question you will be asked.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export type RequestStatus = "queued" | "dispatched" | "failed";

export interface ProvisionRequest {
  slug: string;
  displayName: string;
  plan: string;
  region: string;
  requestedBy: string;
  status: RequestStatus;
  detail?: string;
  at: string;
}

/** Ephemeral — same swap point and the same globalThis caveat as the event log
 *  in lib/registry.ts. Survives hot reload; does not survive a second instance. */
const globalStore = globalThis as unknown as { __provisionRequests?: ProvisionRequest[] };
const requests: ProvisionRequest[] = (globalStore.__provisionRequests ??= []);

async function db(): Promise<Queryable | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { Pool } = await import("pg");
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
  return new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 2,
  }) as unknown as Queryable;
}

export async function readRequests(): Promise<ProvisionRequest[]> {
  const conn = await db();
  return conn ? readRequestsDb(conn) : requests;
}

// Re-exported for server-side callers. Client components must import these
// from ./plans directly — see the note there.
export { PLANS, REGIONS } from "./plans";

/**
 * Subdomains core and the platform reserve. A tenant slug becomes
 * `<slug>.trashlab.app`, the Vercel project name, and the repo name, so a
 * collision here is expensive to unwind later.
 */
const RESERVED = new Set([
  "www", "api", "admin", "app", "control", "staging", "preview", "internal",
  "status", "docs", "mail", "support", "billing", "auth", "cdn", "assets",
]);

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export interface ValidationError {
  field: string;
  message: string;
}

export async function validate(input: {
  slug: string;
  displayName: string;
  plan: string;
  region: string;
}): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  if (!input.displayName?.trim()) {
    errors.push({ field: "displayName", message: "Company name is required." });
  }

  if (!SLUG.test(input.slug)) {
    errors.push({
      field: "slug",
      message:
        "Must be 3–40 characters, lowercase letters, digits and hyphens, starting with a letter and not ending in a hyphen.",
    });
  } else if (RESERVED.has(input.slug)) {
    errors.push({ field: "slug", message: `"${input.slug}" is reserved by the platform.` });
  } else if ((await readTenants()).some((t) => t.id === input.slug)) {
    errors.push({ field: "slug", message: `"${input.slug}" already exists in the fleet.` });
  }

  if (!PLANS.includes(input.plan as (typeof PLANS)[number])) {
    errors.push({ field: "plan", message: "Unknown plan." });
  }
  if (!REGIONS.includes(input.region as (typeof REGIONS)[number])) {
    errors.push({ field: "region", message: "Unknown region." });
  }

  return errors;
}

/** Turn a company name into a suggested slug. */
export function suggestSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/**
 * Hands the request to the provisioning workflow.
 *
 * Without GITHUB_DISPATCH_TOKEN configured the request is recorded as `queued`
 * and nothing is dispatched — the console stays useful for demos without
 * holding a credential that can create repositories.
 */
export async function submit(input: {
  slug: string;
  displayName: string;
  plan: string;
  region: string;
  requestedBy: string;
}): Promise<ProvisionRequest> {
  const record: ProvisionRequest = { ...input, status: "queued", at: new Date().toISOString() };

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.PLATFORM_REPO ?? "chaumn16/trashlab-platform";

  if (!token) {
    record.detail = "GITHUB_DISPATCH_TOKEN not configured — recorded but not dispatched.";
    await persist(record);
    return record;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "provision-tenant",
        client_payload: {
          slug: input.slug,
          displayName: input.displayName,
          plan: input.plan,
          region: input.region,
          requestedBy: input.requestedBy,
        },
      }),
    });

    if (!res.ok) {
      record.status = "failed";
      record.detail = `GitHub dispatch failed: ${res.status} ${await res.text()}`;
    } else {
      record.status = "dispatched";
      record.detail = "Provisioning workflow started. Live in about four minutes.";
    }
  } catch (err) {
    record.status = "failed";
    record.detail = err instanceof Error ? err.message : String(err);
  }

  await persist(record);
  return record;
}

async function persist(r: ProvisionRequest): Promise<void> {
  const conn = await db();
  if (conn) {
    await recordRequestDb(conn, r);
    return;
  }
  requests.unshift(r);
  requests.length = Math.min(requests.length, 25);
}
