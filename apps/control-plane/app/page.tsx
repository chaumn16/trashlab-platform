import { readTenants, readChannels, readEvents, semverLt } from "../lib/registry";
import { readRequests } from "../lib/provision";

/**
 * Fleet dashboard.
 *
 * The screen an engineer opens during a rollout and a CS rep opens when a
 * customer asks why their site looks different. Everything here is sliced by
 * core version, because "4.3.0 is bad on three tenants" is the question you
 * actually need answered — not "errors are up".
 */
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const tenants = await readTenants();
  const channels = await readChannels();
  const events = await readEvents();
  const requests = await readRequests();

  const behind = tenants.filter((t) => semverLt(t.coreVersion, channels.stable));
  const expired = tenants.filter((t) => t.pinExpiry && new Date(t.pinExpiry) < new Date());
  const custom = tenants.filter((t) => t.hasCustomCode);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 22, display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-.01em" }}>TrashLab Control Plane</h1>
          <p style={{ margin: "4px 0 0", color: "#667085", fontSize: 13 }}>
            {tenants.length} tenants · stable {channels.stable} · beta {channels.beta} · canary{" "}
            {channels.canary}
          </p>
        </div>
        <a
          href="/tenants/new"
          style={{
            marginLeft: "auto", background: "#1f6feb", color: "#fff", borderRadius: 6,
            padding: "9px 16px", fontSize: 14, fontWeight: 600, textDecoration: "none",
          }}
        >
          Add tenant
        </a>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 20 }}>
        <Stat label="Tenants" value={String(tenants.length)} />
        <Stat label="On stable" value={String(tenants.length - behind.length)} />
        <Stat label="Behind stable" value={String(behind.length)} accent={behind.length ? "#b45309" : undefined} />
        <Stat label="Carrying custom code" value={String(custom.length)} accent="#1f6feb" />
      </div>

      {(behind.length > 0 || expired.length > 0) && (
        <Card accent="#b45309">
          <h2 style={h2}>Drift</h2>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "#667085" }}>
            The metric that tells you this model is failing before it becomes a crisis.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {behind.map((t) => (
              <li key={t.id}>
                <strong>{t.id}</strong> on {t.coreVersion}, stable is {channels.stable}
              </li>
            ))}
            {expired.map((t) => (
              <li key={`x-${t.id}`} style={{ color: "#b42318" }}>
                <strong>{t.id}</strong> pin expired {t.pinExpiry?.slice(0, 10)} — {t.pinReason ?? "no reason recorded"}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 style={h2}>Fleet</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#667085", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                <th style={th}>Tenant</th><th style={th}>Core</th><th style={th}>Channel</th>
                <th style={th}>Custom</th><th style={th}>Plan</th><th style={th}>Region</th>
                <th style={th}>Health</th><th style={th}>Last deploy</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const stale = semverLt(t.coreVersion, channels.stable);
                return (
                  <tr key={t.id} style={{ borderTop: "1px solid #e4e7ec" }}>
                    <td style={td}>
                      <a href={`https://${t.domain}`} style={{ color: "#1f6feb", textDecoration: "none" }}>
                        {t.id}
                      </a>
                    </td>
                    <td style={{ ...td, color: stale ? "#b45309" : undefined, fontWeight: stale ? 600 : 400 }}>
                      {t.coreVersion}
                    </td>
                    <td style={td}>{t.channel}</td>
                    <td style={td}>{t.hasCustomCode ? <Pill tone="blue">yes</Pill> : <span style={{ color: "#98a2b3" }}>no</span>}</td>
                    <td style={td}>{t.plan}</td>
                    <td style={td}>{t.region}</td>
                    <td style={td}><Health value={t.health} /></td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{t.lastDeploy?.slice(0, 10) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {requests.length > 0 && (
        <Card accent="#1f6feb">
          <h2 style={h2}>Provisioning</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {requests.map((r, i) => (
                <tr key={i} style={{ borderTop: i ? "1px solid #e4e7ec" : undefined }}>
                  <td style={td}><strong>{r.slug}</strong> — {r.displayName}</td>
                  <td style={td}>{r.plan} · {r.region}</td>
                  <td style={td}>
                    <span style={{
                      background: r.status === "dispatched" ? "#d1e7dd" : r.status === "failed" ? "#f8d7da" : "#fff3cd",
                      color: r.status === "dispatched" ? "#0f5132" : r.status === "failed" ? "#842029" : "#664d03",
                      borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 600,
                    }}>{r.status}</span>
                  </td>
                  <td style={{ ...td, color: "#667085" }}>{r.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <h2 style={h2}>Recent CI and deploy events</h2>
        {events.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#667085" }}>
            Nothing reported yet. Tenant CI posts to <code>/api/ci-result</code> and deploys post to{" "}
            <code>/api/deploy-result</code>.
            <br />
            <span style={{ color: "#b45309" }}>
              Note: events are held in memory and are lost on cold start — see the swap point in
              lib/registry.ts.
            </span>
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {events.map((e, i) => (
              <li key={i}>
                <code>{e.kind}</code> {e.tenantId} — {e.status} <span style={{ color: "#98a2b3" }}>{e.at}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <section
      style={{
        border: "1px solid #e4e7ec",
        borderTop: accent ? `3px solid ${accent}` : "1px solid #e4e7ec",
        borderRadius: 10,
        padding: "16px 18px",
        background: "#fff",
        marginBottom: 18,
      }}
    >
      {children}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: "14px 16px", background: "#fff" }}>
      <div style={{ fontSize: 12, color: "#667085", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: accent ?? "#14181f" }}>{value}</div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "blue" }) {
  const tones = { blue: ["#084298", "#cfe2ff"] } as const;
  const [fg, bg] = tones[tone];
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>{children}</span>;
}

function Health({ value }: { value: string }) {
  const map: Record<string, [string, string]> = {
    green: ["#0f5132", "#d1e7dd"],
    stale: ["#664d03", "#fff3cd"],
    provisioning: ["#084298", "#cfe2ff"],
  };
  const [fg, bg] = map[value] ?? ["#842029", "#f8d7da"];
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 600 }}>{value}</span>;
}

const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", color: "#667085" };
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "9px 8px" };
