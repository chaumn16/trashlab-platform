import { authorize } from "../../../lib/auth";
import { readTenants, readChannels } from "../../../lib/registry";
import { validate, submit, suggestSlug } from "../../../lib/provision";

/**
 * GET /api/tenants
 *
 * The fleet, as data. The platform CLI reads this instead of a local JSON file
 * once the control plane is deployed — see packages/cli/lib/registry.mjs.
 */
export async function GET(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  return Response.json({ coreChannels: readChannels(), tenants: readTenants() });
}

/**
 * POST /api/tenants
 *
 * The programmatic equivalent of the Add-tenant console form — for a CRM
 * integration that provisions on "deal won" rather than a human filling in a
 * form. Shares the console's validation, so the two paths cannot drift.
 */
export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: { slug?: string; displayName?: string; plan?: string; region?: string; requestedBy?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const displayName = (body.displayName ?? "").trim();
  const slug = (body.slug ?? "").trim() || suggestSlug(displayName);
  const plan = body.plan ?? "growth";
  const region = body.region ?? "iad1";

  const errors = validate({ slug, displayName, plan, region });
  if (errors.length) {
    return Response.json({ error: "validation failed", errors }, { status: 422 });
  }

  const record = await submit({
    slug, displayName, plan, region,
    requestedBy: body.requestedBy ?? "api",
  });

  return Response.json(record, { status: record.status === "failed" ? 502 : 202 });
}
