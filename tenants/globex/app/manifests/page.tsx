import { getStore } from "../../lib/store";
import tenant from "../../tenant.config";

/**
 * A page that exists only for Globex.
 *
 * An ordinary Next.js route in the tenant repo. Next resolves /manifests before
 * the core catch-all at app/[[...slug]], so no registration is needed and there
 * is no way for a tenant page to accidentally shadow a core route — core's
 * reserved paths are rejected by the conformance suite.
 */
export default async function ManifestsPage() {
  const db = await getStore();
  const jobs = (await db.listJobs()).filter((j) => j.serviceType === "rolloff");

  return (
    <section
      style={{
        border: "1px solid #e4e7ec",
        borderRadius: 10,
        padding: "16px 18px",
        background: "#fff",
        borderTop: `3px solid ${tenant.theme.brandColor}`,
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>EPA manifests</h2>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#667085" }}>
        Regulated rolloff hauls requiring a filed manifest. Globex-specific — core has no
        concept of this page.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#667085", fontSize: 12 }}>
            <th style={{ padding: "6px 8px", fontWeight: 500 }}>Job</th>
            <th style={{ padding: "6px 8px", fontWeight: 500 }}>Generator code</th>
            <th style={{ padding: "6px 8px", fontWeight: 500 }}>Weight</th>
            <th style={{ padding: "6px 8px", fontWeight: 500 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const code = typeof j.custom.epaGeneratorCode === "string" ? j.custom.epaGeneratorCode : null;
            return (
              <tr key={j.id} style={{ borderTop: "1px solid #e4e7ec" }}>
                <td style={{ padding: "9px 8px" }}>{j.id}</td>
                <td style={{ padding: "9px 8px", fontFamily: "ui-monospace, monospace" }}>{code ?? "—"}</td>
                <td style={{ padding: "9px 8px", fontVariantNumeric: "tabular-nums" }}>
                  {j.weightLbs?.toLocaleString() ?? "—"} lbs
                </td>
                <td style={{ padding: "9px 8px" }}>
                  {code ? (
                    <span style={{ background: "#d1e7dd", color: "#0f5132", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
                      ready
                    </span>
                  ) : (
                    <span style={{ background: "#f8d7da", color: "#842029", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
                      blocked
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
