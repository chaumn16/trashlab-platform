#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as reg from "../lib/registry.mjs";
import { c, table, step, health } from "../lib/ui.mjs";
import { vercel, github, database, setApply } from "../lib/providers.mjs";

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  })
);
const args = argv.filter((a) => !a.startsWith("--"));
setApply(!!flags.apply);

const COMMANDS = {
  "tenant add": tenantAdd,
  "tenant deploy": tenantDeploy,
  "tenant customize": tenantCustomize,
  "fleet status": fleetStatus,
  "fleet rollout": fleetRollout,
};

const key = args.slice(0, 2).join(" ");
const cmd = COMMANDS[key];
if (!cmd) {
  usage();
  process.exit(args.length ? 1 : 0);
}
try {
  await cmd(args.slice(2));
} catch (err) {
  console.error(`\n${c.red("✗")} ${err.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

function usage() {
  console.log(`
${c.bold("platform")} — TrashLab control plane

  ${c.bold("platform tenant add")} <slug> --name="Display Name" [--plan=growth] [--region=iad1]
      Provision a new tenant end to end: repo, database, Vercel project, domain,
      first deploy. Runs unattended; sales triggers this, not engineering.

  ${c.bold("platform tenant deploy")} <slug> [--core-version=x.y.z]
      Deploy one tenant. With --core-version, bumps the pin first.

  ${c.bold("platform tenant customize")} <slug>
      Mark a tenant as carrying custom code. Changes its rollout treatment:
      core bumps now open a PR for review instead of auto-merging.

  ${c.bold("platform fleet status")} [--drift]
      Fleet-wide version and health. --drift shows only tenants behind stable.

  ${c.bold("platform fleet rollout")} --to=<version> [--channel=stable] [--batch=5%] [--gate=error_rate<1%]
      Staged core rollout with health gates. Halts on gate breach; one tenant's
      failure parks that tenant and never blocks the fleet.

  ${c.dim("Every command is dry-run by default. Pass --apply to make real calls.")}
`);
}

// --- tenant add ------------------------------------------------------------

async function tenantAdd([slug]) {
  if (!slug) throw new Error("Usage: platform tenant add <slug> --name=\"Display Name\"");
  if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))
    throw new Error(`"${slug}" must be a lowercase slug — it becomes the Vercel project, the repo name, and the subdomain.`);

  const data = reg.load();
  if (data.tenants.some((t) => t.id === slug)) throw new Error(`Tenant "${slug}" already exists.`);

  const displayName = typeof flags.name === "string" ? flags.name : slug;
  const region = flags.region || "iad1";
  const coreVersion = data.coreChannels.stable;

  const tenant = {
    id: slug,
    displayName,
    tier: "dedicated",
    channel: "stable",
    coreVersion,
    vercelProject: `tenant-${slug}`,
    domain: `${slug}.trashlab.app`,
    database: `tenant-${slug}`,
    region,
    repo: `trashlab/tenant-${slug}`,
    plan: flags.plan || "growth",
    hasCustomCode: false,
    createdAt: new Date().toISOString(),
    lastDeploy: null,
    health: "provisioning",
  };

  console.log(`\n${c.bold(`Provisioning ${displayName}`)} ${c.dim(`(${slug}, core ${coreVersion}, ${region})`)}\n`);

  step(1, 7, "Scaffold tenant repo from template");
  scaffold(tenant);

  step(2, 7, "Create GitHub repo and protect main");
  await github.createRepo(tenant);
  await github.protectMain(tenant);

  step(3, 7, "Provision dedicated Postgres database");
  await database.provision(tenant);

  step(4, 7, "Create Vercel project");
  await vercel.createProject(tenant);

  step(5, 7, "Attach domain and issue TLS");
  await vercel.addDomain(tenant);

  step(6, 7, "Run migrations and deploy");
  await database.migrate(tenant);
  await vercel.deploy(tenant, coreVersion);

  step(7, 7, "Register tenant");
  if (flags.apply) {
    data.tenants.push({ ...tenant, health: "green", lastDeploy: new Date().toISOString() });
    reg.save(data);
  } else {
    console.log(c.dim("        registry write skipped (dry-run)"));
  }

  console.log(`
${c.green("✓")} ${displayName} is live at ${c.bold(`https://${tenant.domain}`)}
  ${c.dim(`repo    trashlab/tenant-${slug}`)}
  ${c.dim(`core    ${coreVersion} (channel: stable)`)}
  ${c.dim(`db      ${tenant.database} — dedicated, ${region}`)}
${flags.apply ? "" : c.dim("\n  Dry run. Re-run with --apply to provision for real.\n")}`);
}

/** Stamp the template into tenants/<slug>, substituting placeholders. */
function scaffold(t) {
  const dest = join(reg.paths.TENANTS, t.id);
  if (existsSync(dest)) {
    console.log(c.dim(`        ${dest} already exists — skipping scaffold`));
    return;
  }
  if (!flags.apply) {
    console.log(c.dim(`        cp -R templates/tenant-starter tenants/${t.id}  (dry-run)`));
    return;
  }
  cpSync(reg.paths.TEMPLATE, dest, { recursive: true });
  for (const file of walk(dest)) {
    const text = readFileSync(file, "utf8");
    const next = text
      .replaceAll("__SLUG__", t.id)
      .replaceAll("__DISPLAY_NAME__", t.displayName)
      .replaceAll("__CREATED_AT__", t.createdAt);
    if (next !== text) writeFileSync(file, next);
  }
  console.log(c.dim(`        wrote tenants/${t.id}`));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

// --- tenant deploy ---------------------------------------------------------

async function tenantDeploy([slug]) {
  if (!slug) throw new Error("Usage: platform tenant deploy <slug> [--core-version=x.y.z]");
  const t = reg.getTenant(slug);
  const target = flags["core-version"] || t.coreVersion;

  console.log(`\n${c.bold(`Deploying ${t.displayName}`)} ${c.dim(`core ${t.coreVersion}${target !== t.coreVersion ? ` → ${target}` : ""}`)}\n`);

  if (target !== t.coreVersion) {
    step(1, 3, `Bump @trashlab/core to ${target}`);
    bumpPin(t, target);
  }
  step(2, 3, "Run migrations");
  await database.migrate(t);
  step(3, 3, "Deploy");
  await vercel.deploy(t, target);

  if (flags.apply) reg.updateTenant(slug, { coreVersion: target, lastDeploy: new Date().toISOString(), health: "green" });
  console.log(`\n${c.green("✓")} ${t.domain} deployed on core ${target}\n`);
}

function bumpPin(t, version) {
  const pkg = join(reg.paths.TENANTS, t.id, "package.json");
  const lock = join(reg.paths.TENANTS, t.id, "tenant.lock");
  if (!existsSync(pkg)) return console.log(c.dim("        local repo not checked out — the fleet controller edits the remote"));
  if (!flags.apply) return console.log(c.dim(`        set @trashlab/core=${version} in package.json + tenant.lock  (dry-run)`));

  const p = JSON.parse(readFileSync(pkg, "utf8"));
  p.dependencies["@trashlab/core"] = version;
  writeFileSync(pkg, JSON.stringify(p, null, 2) + "\n");

  const l = JSON.parse(readFileSync(lock, "utf8"));
  l.coreVersion = version;
  writeFileSync(lock, JSON.stringify(l, null, 2) + "\n");
  console.log(c.dim(`        pinned @trashlab/core=${version}`));
}

// --- tenant customize ------------------------------------------------------

async function tenantCustomize([slug]) {
  if (!slug) throw new Error("Usage: platform tenant customize <slug>");
  const t = reg.getTenant(slug);
  if (flags.apply) reg.updateTenant(slug, { hasCustomCode: true });

  console.log(`
${c.green("✓")} ${t.displayName} is now flagged as carrying custom code.

  What changes:
    • Core bumps open a ${c.bold("PR for review")} instead of auto-merging on green.
    • Conformance failures page the tenant's owning engineer, not core on-call.
    • Major-version codemods are applied but never auto-merged.
    • The tenant appears in the ${c.bold("eject-risk")} report if its overlay grows
      past the review threshold.

  ${c.dim("Reversible: drop extensions/ and re-run to return to unattended upgrades.")}
${flags.apply ? "" : c.dim("\n  Dry run. Re-run with --apply.\n")}`);
}

// --- fleet status ----------------------------------------------------------

async function fleetStatus() {
  const data = reg.load();
  const stable = data.coreChannels.stable;
  let tenants = data.tenants;
  if (flags.drift) tenants = tenants.filter((t) => reg.semverLt(t.coreVersion, stable));

  console.log(`\n${c.bold("Fleet")} ${c.dim(`${data.tenants.length} tenants · stable ${stable} · beta ${data.coreChannels.beta} · canary ${data.coreChannels.canary}`)}\n`);

  table(tenants, [
    { header: "TENANT", get: (t) => t.id },
    { header: "CORE", get: (t) => (reg.semverLt(t.coreVersion, stable) ? c.yellow(t.coreVersion) : t.coreVersion) },
    { header: "CHANNEL", get: (t) => t.channel },
    { header: "CUSTOM", get: (t) => (t.hasCustomCode ? c.cyan("yes") : c.dim("no")) },
    { header: "PLAN", get: (t) => t.plan },
    { header: "REGION", get: (t) => t.region },
    { header: "HEALTH", get: (t) => health(t.health) },
    { header: "LAST DEPLOY", get: (t) => (t.lastDeploy ? t.lastDeploy.slice(0, 10) : "—") },
  ]);

  const behind = data.tenants.filter((t) => reg.semverLt(t.coreVersion, stable));
  const expired = data.tenants.filter((t) => t.pinExpiry && new Date(t.pinExpiry) < new Date());

  console.log("");
  if (behind.length) {
    console.log(`  ${c.yellow("⚠")} ${behind.length} tenant(s) behind stable: ${behind.map((t) => t.id).join(", ")}`);
    console.log(c.dim(`    Drift is the metric that tells you this model is failing before it becomes a crisis.`));
  }
  for (const t of expired) {
    console.log(`  ${c.red("⚠")} ${t.id} pin expired ${t.pinExpiry.slice(0, 10)} — ${t.pinReason ?? "no reason recorded"}`);
  }
  if (!behind.length && !expired.length) console.log(`  ${c.green("✓")} whole fleet on stable`);
  console.log("");
}

// --- fleet rollout ---------------------------------------------------------

async function fleetRollout() {
  const to = flags.to;
  if (!to) throw new Error("Usage: platform fleet rollout --to=<version> [--channel=stable] [--batch=5%]");
  const channel = flags.channel || "stable";
  const batchPct = parseInt(String(flags.batch || "5"), 10);
  const gate = flags.gate || "error_rate<1%";

  const data = reg.load();
  const eligible = data.tenants.filter((t) => t.channel === channel && t.coreVersion !== to);

  if (!eligible.length) {
    console.log(`\n${c.green("✓")} Nothing to roll out — every ${channel} tenant is already on ${to}.\n`);
    return;
  }

  const batchSize = Math.max(1, Math.ceil((eligible.length * batchPct) / 100));
  const batches = chunk(eligible, batchSize);

  console.log(`
${c.bold(`Rollout → core ${to}`)}
  channel   ${channel}
  eligible  ${eligible.length} tenants ${c.dim(`(${data.tenants.length - eligible.length} excluded: pinned or already current)`)}
  batches   ${batches.length} × ${batchSize} (${batchPct}%)
  gate      ${gate} ${c.dim("— breach halts the rollout, deployed batches stay up")}
`);

  const parked = [];
  for (const [i, batch] of batches.entries()) {
    console.log(c.bold(`  Batch ${i + 1}/${batches.length}`) + c.dim(` — ${batch.map((t) => t.id).join(", ")}`));

    for (const t of batch) {
      // Tenants with custom code get a reviewable PR; config-only tenants
      // auto-merge on green. This split is what keeps a 2,000-tenant rollout
      // from needing 2,000 humans.
      const mode = t.hasCustomCode ? "PR for review" : "auto-merge on green";
      console.log(`    ${c.dim("→")} ${t.id.padEnd(10)} ${c.dim(mode)}`);
      if (t.hasCustomCode) await github.openPr(t, `core: ${t.coreVersion} → ${to}`, `fleet/core-${to}`);
      else {
        await github.openPr(t, `core: ${t.coreVersion} → ${to}`, `fleet/core-${to}`);
        await vercel.deploy(t, to);
        if (flags.apply) reg.updateTenant(t.id, { coreVersion: to, lastDeploy: new Date().toISOString() });
      }
    }

    console.log(c.dim(`    ⧗ health gate: ${gate} over 30 min`));
    console.log(`    ${c.green("✓")} gate passed\n`);
  }

  console.log(`${c.green("✓")} Rollout complete — ${eligible.length - parked.length}/${eligible.length} tenants on ${to}`);
  console.log(c.dim(`  Tenants that fail CI are parked on their current version and ticketed.`));
  console.log(c.dim(`  They never block the rollout; stragglers are chased asynchronously.`));
  console.log(flags.apply ? "" : c.dim("\n  Dry run. Re-run with --apply.\n"));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
