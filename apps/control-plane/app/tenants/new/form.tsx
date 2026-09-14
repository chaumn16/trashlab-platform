"use client";

import { useActionState } from "react";
import { createTenant, type FormState } from "./actions";
import { PLANS, REGIONS } from "../../../lib/provision";

/**
 * The screen sales uses to onboard a customer.
 *
 * Deliberately four fields. Everything else — core version, tier, database,
 * domain, CI, branch protection — is decided by the platform, not typed in by
 * whoever closed the deal. Every field here is one a salesperson actually knows
 * the answer to.
 */
export function NewTenantForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createTenant, {});
  const err = (f: string) => state.errors?.find((e) => e.field === f)?.message;

  if (state.ok) {
    const dispatched = state.status === "dispatched";
    return (
      <div style={{ ...card, borderTop: `3px solid ${dispatched ? "#0f5132" : "#b45309"}` }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16, color: dispatched ? "#0f5132" : "#b45309" }}>
          {dispatched ? "Provisioning started" : "Request recorded — not provisioned"}
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 14 }}>{state.message}</p>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/tenants/new" style={btnPrimary}>Add another</a>
          <a href="/" style={btnSecondary}>Back to fleet</a>
        </div>
      </div>
    );
  }

  return (
    <form action={action} style={card}>
      {state.message && (
        <p style={{ margin: "0 0 14px", padding: "10px 12px", background: "#fdecea", color: "#842029", borderRadius: 6, fontSize: 13 }}>
          {state.message}
        </p>
      )}

      <Field label="Company name" hint="As it should appear in their app header." error={err("displayName")}>
        <input name="displayName" defaultValue={state.values?.displayName} placeholder="Northwind Disposal" style={input} required autoFocus />
      </Field>

      <Field
        label="Subdomain"
        hint="Leave blank to derive it from the company name. Becomes their URL, repo, and Vercel project — it cannot be changed later."
        error={err("slug")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input name="slug" defaultValue={state.values?.slug} placeholder="northwind" style={{ ...input, flex: 1 }} />
          <span style={{ color: "#667085", fontSize: 13, whiteSpace: "nowrap" }}>.trashlab.app</span>
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Plan" error={err("plan")}>
          <select name="plan" defaultValue={state.values?.plan ?? "growth"} style={input}>
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Region" hint="Set once, at creation." error={err("region")}>
          <select name="region" defaultValue={state.values?.region ?? "iad1"} style={input}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>

      <button type="submit" disabled={pending} style={{ ...btnPrimary, opacity: pending ? 0.6 : 1, marginTop: 6 }}>
        {pending ? "Provisioning…" : "Create tenant"}
      </button>

      <p style={{ margin: "14px 0 0", fontSize: 12, color: "#667085" }}>
        Creates a repo, a dedicated database, a Vercel project, and a TLS domain, then deploys
        core <strong>stable</strong> and smoke-tests it. About four minutes. No engineer required.
      </p>
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {hint && <span style={{ display: "block", fontSize: 12, color: "#667085", marginBottom: 6 }}>{hint}</span>}
      {children}
      {error && <span style={{ display: "block", fontSize: 12, color: "#b42318", marginTop: 5 }}>{error}</span>}
    </label>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e4e7ec", borderRadius: 10, padding: "20px 22px",
  background: "#fff", maxWidth: 560,
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 6,
  fontSize: 14, font: "inherit", boxSizing: "border-box",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-block", background: "#1f6feb", color: "#fff", border: "none",
  borderRadius: 6, padding: "9px 16px", fontSize: 14, fontWeight: 600,
  cursor: "pointer", textDecoration: "none",
};
const btnSecondary: React.CSSProperties = {
  display: "inline-block", background: "#fff", color: "#344054", border: "1px solid #d0d5dd",
  borderRadius: 6, padding: "9px 16px", fontSize: 14, textDecoration: "none",
};
