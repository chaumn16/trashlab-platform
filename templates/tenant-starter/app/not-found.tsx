import tenant from "../tenant.config";

/**
 * Rendered with a real HTTP 404 when core's catch-all finds no matching route.
 *
 * Core calls notFound() rather than returning a styled card with status 200.
 * The catch-all matches every path, so a soft 404 would mean every URL in every
 * tenant returned 200 — silently defeating the deploy smoke test, which checks
 * status codes to decide whether a release is healthy.
 */
export default function NotFound() {
  return (
    <section
      style={{
        border: "1px solid #e4e7ec",
        borderTop: `3px solid ${tenant.theme.brandColor}`,
        borderRadius: 10,
        padding: "20px 22px",
        background: "#fff",
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: 16 }}>Page not found</h2>
      <p style={{ margin: "0 0 14px", fontSize: 14, color: "#667085" }}>
        That page doesn&apos;t exist in {tenant.displayName}.
      </p>
      <a href="/" style={{ color: tenant.theme.brandColor, fontSize: 14 }}>
        Back to dashboard
      </a>
    </section>
  );
}
