import * as React from "react";
import type { SlotContent } from "../extend/types.js";
import { formatMoney } from "../extend/index.js";
import type { Money } from "../extend/types.js";

export function Card(props: { title?: string; children: React.ReactNode; accent?: string }) {
  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "16px 18px",
        background: "var(--surface)",
        borderTop: props.accent ? `3px solid ${props.accent}` : undefined,
      }}
    >
      {props.title && (
        <h2 style={{ margin: "0 0 12px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>
          {props.title}
        </h2>
      )}
      {props.children}
    </section>
  );
}

export function Stat(props: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{props.label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: props.accent ?? "var(--fg)" }}>{props.value}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    completed: ["#0f5132", "#d1e7dd"],
    scheduled: ["#084298", "#cfe2ff"],
    en_route: ["#664d03", "#fff3cd"],
    skipped: ["#842029", "#f8d7da"],
  };
  const [fg, bg] = colors[status] ?? ["#333", "#eee"];
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
      {status.replace("_", " ")}
    </span>
  );
}

export function MoneyCell({ amount }: { amount: Money }) {
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(amount)}</span>;
}

/**
 * Renders tenant-supplied slot content. Tenant slots return a serializable
 * description rather than JSX, so core controls the markup — an agent cannot
 * inject arbitrary DOM or scripts into the admin shell.
 */
export function SlotView({ content }: { content: SlotContent | null }) {
  if (!content) return null;
  switch (content.kind) {
    case "text":
      return <p style={{ margin: 0, fontSize: 14 }}>{content.value}</p>;
    case "stat":
      return <Stat label={content.label} value={content.value} />;
    case "link":
      return (
        <a href={content.href} style={{ color: "var(--brand)", fontSize: 14 }}>
          {content.label}
        </a>
      );
    case "rows":
      return (
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>{content.title}</h3>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
            {content.rows.map((r) => (
              <React.Fragment key={r.label}>
                <dt style={{ color: "var(--muted)" }}>{r.label}</dt>
                <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{r.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      );
  }
}
