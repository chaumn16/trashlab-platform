import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token auth for the callback endpoints.
 *
 * Every tenant repo holds a CONTROL_PLANE_TOKEN. In production these are
 * per-tenant tokens checked against the registry, so a leaked token from one
 * repo can only write that tenant's status — consistent with every other
 * credential in this system being scoped to a single tenant.
 *
 * This implementation checks one shared token, which is the one place the
 * demo is weaker than the design it describes.
 */
export function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.CONTROL_PLANE_TOKEN;

  // Fail closed. An unset token must never mean "allow everyone".
  if (!expected) {
    return { ok: false, status: 503, error: "CONTROL_PLANE_TOKEN is not configured" };
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) return { ok: false, status: 401, error: "missing bearer token" };

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first —
  // still constant-time with respect to content.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "invalid token" };
  }
  return { ok: true };
}
