import { authorize } from "../../../lib/auth";
import { recordEvent } from "../../../lib/registry";

/**
 * POST /api/ci-result
 *
 * Called by every tenant repo's CI workflow on every PR. This is how the fleet
 * dashboard knows which tenants are green against which core version — the
 * signal that decides whether a rollout batch may be promoted.
 */
export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: { tenantId?: string; sha?: string; pr?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.tenantId || !body.status) {
    return Response.json({ error: "tenantId and status are required" }, { status: 400 });
  }

  await recordEvent({
    kind: "ci",
    tenantId: body.tenantId,
    status: body.status,
    sha: body.sha,
    pr: body.pr,
    at: new Date().toISOString(),
  });

  return Response.json({ ok: true });
}
