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

/**
 * Describes a token without revealing it.
 *
 * Reports length, whether it had surrounding whitespace, and which kind of
 * GitHub token it looks like. That is enough to diagnose the usual causes of a
 * 401 — a newline from a copy-paste, a truncated value, or a secret that is not
 * a PAT at all — without putting any part of the credential in a response.
 */
function describeToken(raw: string | undefined) {
  if (!raw) return { configured: false };
  const t = raw.trim();
  const kind = t.startsWith("github_pat_")
    ? "fine-grained PAT"
    : t.startsWith("ghp_")
      ? "classic PAT"
      : t.startsWith("gho_") || t.startsWith("ghu_")
        ? "OAuth token (wrong kind for this)"
        : "unrecognised — does not look like a GitHub PAT";
  return {
    configured: true,
    kind,
    length: t.length,
    hadSurroundingWhitespace: t.length !== raw.length,
  };
}

export async function GET() {
  const storage = await describeStorage();
  return Response.json(
    {
      ok: storage.ok,
      storage,
      tokenConfigured: Boolean(process.env.CONTROL_PLANE_TOKEN),
      dispatchToken: describeToken(process.env.GITHUB_DISPATCH_TOKEN),
      platformRepo: process.env.PLATFORM_REPO ?? "chaumn16/trashlab-platform",
      time: new Date().toISOString(),
    },
    { status: storage.ok ? 200 : 503 }
  );
}
