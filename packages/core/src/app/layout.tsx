import * as React from "react";
import type { TenantConfig } from "../extend/types.js";
import { createRuntime } from "../domain/runtime.js";
import { createStore } from "../db/store.js";
import { SlotView } from "./ui.js";

/**
 * Core admin shell. Owns navigation, branding, and the version badge.
 *
 * Tenants theme this via TenantConfig.theme and extend the nav via
 * customRoutes + the "nav.primary" slot. They cannot replace the shell —
 * auth, the tenant switcher, and the support affordances live here and must
 * behave identically across all 2,000 apps.
 */
export function CoreLayout({
  config,
  coreVersion,
  children,
}: {
  config: TenantConfig;
  coreVersion: string;
  children: React.ReactNode;
}) {
  const runtime = createRuntime(config, createStore());
  const navExtra = runtime.renderSlot("nav.primary", { tenantId: config.id });

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/jobs", label: "Jobs" },
    { href: "/customers", label: "Customers" },
    ...(config.features.invoicing ? [{ href: "/invoices", label: "Invoices" }] : []),
    ...(config.customRoutes ?? []).filter((r) => r.showInNav !== false).map((r) => ({ href: r.path, label: r.label })),
  ];

  return (
    <div
      style={{
        // Theme tokens. Tenant branding is confined to these variables, so a
        // tenant cannot restyle the shell into something unrecognizable to
        // support staff working across accounts.
        ["--brand" as string]: config.theme.brandColor,
        ["--fg" as string]: "#14181f",
        ["--muted" as string]: "#667085",
        ["--line" as string]: "#e4e7ec",
        ["--surface" as string]: "#ffffff",
        ["--bg" as string]: "#f6f7f9",
        background: "var(--bg)",
        color: "var(--fg)",
        minHeight: "100vh",
        font: "14px/1.5 ui-sans-serif, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <header style={{ background: "var(--brand)", color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16, letterSpacing: "-.01em" }}>{config.theme.logoText}</strong>
        <nav style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} style={{ color: "#fff", opacity: 0.92, textDecoration: "none", fontSize: 14 }}>
              {l.label}
            </a>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 11, opacity: 0.85 }}>
          {navExtra && <SlotView content={navExtra} />}
          {/* Version badge is non-negotiable: support must be able to read a
              tenant's core version off any screenshot. */}
          <span style={{ border: "1px solid rgba(255,255,255,.4)", borderRadius: 999, padding: "2px 9px" }}>
            {config.id} · core {coreVersion}
          </span>
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px" }}>{children}</main>
    </div>
  );
}
