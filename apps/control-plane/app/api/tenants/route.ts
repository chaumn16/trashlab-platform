import { authorize } from "../../../lib/auth";
import { readTenants, readChannels } from "../../../lib/registry";

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
