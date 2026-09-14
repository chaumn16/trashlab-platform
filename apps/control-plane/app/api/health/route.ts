import { describeStorage } from "../../../lib/registry";

/**
 * GET /api/health — unauthenticated on purpose.
 *
 * When the dashboard fails, the operator needs to know *why* before they can
 * authenticate, and a 500 with no body tells them nothing. This reports whether
 * a database is configured and whether it can actually be reached.
 *
 * It deliberately exposes no secrets: booleans, the host, and the driver's error
 * message — never the connection string, credentials, or tenant data.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const storage = await describeStorage();
  return Response.json(
    {
      ok: storage.ok,
      storage,
      tokenConfigured: Boolean(process.env.CONTROL_PLANE_TOKEN),
      dispatchConfigured: Boolean(process.env.GITHUB_DISPATCH_TOKEN),
      time: new Date().toISOString(),
    },
    { status: storage.ok ? 200 : 503 }
  );
}
