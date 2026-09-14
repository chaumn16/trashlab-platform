import * as React from "react";
import { notFound } from "next/navigation";
import type { TenantConfig } from "../extend/types.js";
import { formatMoney } from "../extend/index.js";
import { createRuntime } from "../domain/runtime.js";
import { createStore, type DataStore } from "../db/store.js";
import { Card, Stat, StatusPill, MoneyCell, SlotView } from "./ui.js";

export { CoreLayout } from "./layout.js";

/**
 * The mountable core application.
 *
 * A tenant repo wires this up in ONE file — app/[[...slug]]/page.tsx — so the
 * tenant repo never forks core's routing, pages, or components. Tenant-specific
 * pages are ordinary Next.js routes in the tenant repo; Next's route specificity
 * means they take precedence over this catch-all automatically.
 */
export async function CoreApp({
  config,
  slug = [],
  store,
}: {
  config: TenantConfig;
  slug?: string[];
  store?: DataStore;
}) {
  const db = store ?? createStore();
  const runtime = createRuntime(config, db);
  const [section, id] = slug;

  if (!section) return <Dashboard config={config} db={db} runtime={runtime} />;
  if (section === "jobs" && id) return <JobDetail id={id} config={config} db={db} runtime={runtime} />;
  if (section === "jobs") return <JobsList db={db} runtime={runtime} />;
  if (section === "customers") return <CustomersList db={db} />;
  if (section === "invoices" && config.features.invoicing)
    return <Invoices db={db} runtime={runtime} />;

  // A real 404, not a styled card served with HTTP 200.
  //
  // The catch-all matches every path, so without this every URL in every tenant
  // returns 200 — which would silently defeat the deploy smoke test in
  // .github/workflows/deploy.yml: a tenant whose routing was completely broken
  // would still report healthy. Tenants can brand the page with app/not-found.tsx.
  notFound();
}

type Runtime = ReturnType<typeof createRuntime>;

async function Dashboard({ config, db, runtime }: { config: TenantConfig; db: DataStore; runtime: Runtime }) {
  const jobs = await db.listJobs();
  const completed = jobs.filter((j) => j.status === "completed");
  const quotes = await Promise.all(completed.map((j) => runtime.priceJob(j)));
  const revenue = quotes.reduce((s, q) => s + q.total.cents, 0);
  const widgets = runtime.renderSlot("dashboard.widgets", { tenantId: config.id });

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <Card><Stat label="Jobs this week" value={String(jobs.length)} /></Card>
        <Card><Stat label="Completed" value={String(completed.length)} /></Card>
        <Card>
          <Stat label="Billed" value={formatMoney({ cents: revenue, currency: "USD" })} accent={config.theme.brandColor} />
        </Card>
        {widgets && <Card accent={config.theme.brandColor}><SlotView content={widgets} /></Card>}
      </div>

      <Card title="Upcoming">
        <JobTable jobs={jobs.filter((j) => j.status !== "completed")} />
      </Card>

      {runtime.hookErrors.length > 0 && <HookErrorPanel runtime={runtime} />}
    </div>
  );
}

async function JobsList({ db, runtime }: { db: DataStore; runtime: Runtime }) {
  const jobs = await db.listJobs();
  const priced = await Promise.all(
    jobs.map(async (j) => ({ job: j, quote: j.status === "completed" ? await runtime.priceJob(j) : null }))
  );

  return (
    <Card title="All jobs">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
            <th style={th}>Job</th><th style={th}>Scheduled</th><th style={th}>Service</th>
            <th style={th}>Weight</th><th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {priced.map(({ job, quote }) => (
            <tr key={job.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={td}><a href={`/jobs/${job.id}`} style={{ color: "var(--brand)" }}>{job.id}</a></td>
              <td style={td}>{new Date(job.scheduledFor).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
              <td style={td}>{job.serviceType}</td>
              <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{job.weightLbs?.toLocaleString() ?? "—"}</td>
              <td style={td}><StatusPill status={job.status} /></td>
              <td style={{ ...td, textAlign: "right" }}>{quote ? <MoneyCell amount={quote.total} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function JobDetail({ id, config, db, runtime }: { id: string; config: TenantConfig; db: DataStore; runtime: Runtime }) {
  const job = await db.getJob(id);
  // Same reason as the catch-all: a missing job is a 404, not a 200 with an
  // apologetic card. Monitoring and the deploy smoke test both read status codes.
  if (!job) notFound();

  const customer = await db.getCustomer(job.customerId);
  const site = await db.getSite(job.siteId);
  const quote = await runtime.priceJob(job);
  const sidebar = runtime.renderSlot("job.detail.sidebar", { tenantId: config.id, job, customer: customer ?? undefined });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <Card title={`Job ${job.id}`}>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0, fontSize: 14 }}>
            <dt style={dt}>Customer</dt><dd style={dd}>{customer?.name ?? "—"}</dd>
            <dt style={dt}>Site</dt><dd style={dd}>{site?.address ?? "—"}</dd>
            <dt style={dt}>Scheduled</dt><dd style={dd}>{new Date(job.scheduledFor).toUTCString()}</dd>
            <dt style={dt}>Status</dt><dd style={dd}><StatusPill status={job.status} /></dd>
            <dt style={dt}>Weight</dt><dd style={dd}>{job.weightLbs?.toLocaleString() ?? "—"} lbs</dd>
            <dt style={dt}>Containers</dt><dd style={dd}>{job.containersServiced ?? "—"}</dd>
          </dl>
        </Card>

        <Card title="Pricing" accent={config.theme.brandColor}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              {quote.lineItems.map((li, i) => (
                <tr key={i} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                  <td style={td}>{li.label}</td>
                  <td style={{ ...td, textAlign: "right" }}><MoneyCell amount={li.amount} /></td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 600 }}>
                <td style={td}>Total</td>
                <td style={{ ...td, textAlign: "right" }}><MoneyCell amount={quote.total} /></td>
              </tr>
            </tbody>
          </table>
          {quote.explain && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Strategy: {quote.explain}
            </p>
          )}
        </Card>
      </div>

      {sidebar && <Card title="Tenant panel" accent={config.theme.brandColor}><SlotView content={sidebar} /></Card>}
    </div>
  );
}

async function CustomersList({ db }: { db: DataStore }) {
  const [customers, sites] = await Promise.all([db.listCustomers(), db.listSites()]);
  return (
    <Card title="Customers">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
            <th style={th}>Name</th><th style={th}>Service</th><th style={th}>Sites</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={td}>{c.name}</td>
              <td style={td}>{c.serviceType}</td>
              <td style={td}>{sites.filter((s) => s.customerId === c.id).map((s) => s.address).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function Invoices({ db, runtime }: { db: DataStore; runtime: Runtime }) {
  const customers = await db.listCustomers();
  const rows = await Promise.all(
    customers.map(async (c) => {
      const jobs = (await db.listJobs({ customerId: c.id })).filter((j) => j.status === "completed");
      const quotes = await Promise.all(jobs.map((j) => runtime.priceJob(j)));
      return { customer: c, jobs: jobs.length, total: quotes.reduce((s, q) => s + q.total.cents, 0) };
    })
  );
  const footer = runtime.renderSlot("invoice.footer", { tenantId: runtime.config.id });

  return (
    <Card title="Invoices">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
            <th style={th}>Customer</th><th style={th}>Jobs</th><th style={{ ...th, textAlign: "right" }}>Amount due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customer.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={td}>{r.customer.name}</td>
              <td style={td}>{r.jobs}</td>
              <td style={{ ...td, textAlign: "right" }}><MoneyCell amount={{ cents: r.total, currency: "USD" }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer && <div style={{ marginTop: 14 }}><SlotView content={footer} /></div>}
    </Card>
  );
}

function HookErrorPanel({ runtime }: { runtime: Runtime }) {
  return (
    <Card title="Tenant extension errors" accent="#b42318">
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>
        Tenant code failed and core fell back to default behaviour. The page still rendered.
        These are routed to this tenant's error queue, not to core on-call.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {runtime.hookErrors.map((e, i) => (
          <li key={i}><code>{e.hook}</code> — {e.message}</li>
        ))}
      </ul>
    </Card>
  );
}

function JobTable({ jobs }: { jobs: Awaited<ReturnType<DataStore["listJobs"]>> }) {
  if (!jobs.length) return <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>Nothing scheduled.</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <tbody>
        {jobs.map((j, i) => (
          <tr key={j.id} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
            <td style={td}><a href={`/jobs/${j.id}`} style={{ color: "var(--brand)" }}>{j.id}</a></td>
            <td style={td}>{new Date(j.scheduledFor).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
            <td style={td}>{j.serviceType}</td>
            <td style={{ ...td, textAlign: "right" }}><StatusPill status={j.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "9px 8px" };
const dt: React.CSSProperties = { color: "var(--muted)" };
const dd: React.CSSProperties = { margin: 0 };
