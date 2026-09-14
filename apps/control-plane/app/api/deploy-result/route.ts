import { authorize } from "../../../lib/auth";
import { recordEvent } from "../../../lib/registry";

/**
 * POST /api/deploy-result
 *
 * Called by every tenant repo's deploy workflow. Feeds the fleet's
 * version-drift view and the rollout health gates: a batch is only promoted
 * once its tenants report a successful deploy and stay healthy.
 */
export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: { tenantId?: string; status?: string; url?: string; sha?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.tenantId || !body.status) {
    return Response.json({ error: "tenantId and status are required" }, { status: 400 });
  }

  recordEvent({
    kind: "deploy",
    tenantId: body.tenantId,
    status: body.status,
    url: body.url,
    sha: body.sha,
    at: new Date().toISOString(),
  });

  return Response.json({ ok: true });
}
