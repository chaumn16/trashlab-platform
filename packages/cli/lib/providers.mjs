import { c } from "./ui.mjs";

/**
 * Vercel + GitHub + Postgres provisioning.
 *
 * Every call is shown before it runs. Without --apply the CLI prints the exact
 * request and changes nothing, which is what makes `tenant add` safe to hand to
 * a sales engineer: the destructive path requires an explicit flag and a token
 * they do not have.
 */

let DRY = true;
export function setApply(apply) {
  DRY = !apply;
}

async function call(label, method, url, body, token) {
  const line = `${c.cyan(method.padEnd(5))} ${url}`;
  if (DRY) {
    console.log(`        ${line} ${c.dim("(dry-run)")}`);
    if (body) console.log(c.dim(`        ${JSON.stringify(body)}`));
    return { dryRun: true };
  }
  if (!token) throw new Error(`${label}: missing API token. Export it and re-run with --apply.`);
  console.log(`        ${line}`);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const VERCEL = "https://api.vercel.com";
const teamQ = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "");

export const vercel = {
  createProject: (t) =>
    call("vercel.createProject", "POST", `${VERCEL}/v10/projects${teamQ()}`, {
      name: t.vercelProject,
      framework: "nextjs",
      gitRepository: { type: "github", repo: t.repo },
      // Per-tenant region. Enterprise customers with data-residency terms get
      // pinned here rather than in application code.
      regions: [t.region],
      environmentVariables: [
        { key: "DATABASE_URL", target: ["production"], type: "encrypted", value: "__PROVISIONED__" },
        { key: "TENANT_ID", target: ["production", "preview"], type: "plain", value: t.id },
      ],
    }, process.env.VERCEL_TOKEN),

  addDomain: (t) =>
    call("vercel.addDomain", "POST", `${VERCEL}/v10/projects/${t.vercelProject}/domains${teamQ()}`, {
      name: t.domain,
    }, process.env.VERCEL_TOKEN),

  deploy: (t, coreVersion) =>
    call("vercel.deploy", "POST", `${VERCEL}/v13/deployments${teamQ()}`, {
      name: t.vercelProject,
      project: t.vercelProject,
      target: "production",
      gitSource: { type: "github", repo: t.repo, ref: "main" },
      meta: { coreVersion, tenantId: t.id },
    }, process.env.VERCEL_TOKEN),

  rollback: (t) =>
    call("vercel.rollback", "POST", `${VERCEL}/v9/projects/${t.vercelProject}/rollback${teamQ()}`, {},
      process.env.VERCEL_TOKEN),
};

export const github = {
  createRepo: (t) =>
    call("github.createRepo", "POST", `https://api.github.com/orgs/trashlab/repos`, {
      name: `tenant-${t.id}`,
      private: true,
      auto_init: false,
      // Branch protection + CODEOWNERS is what bounds an AI agent to this repo's
      // own business logic.
      delete_branch_on_merge: true,
    }, process.env.GITHUB_TOKEN),

  protectMain: (t) =>
    call("github.protectMain", "PUT", `https://api.github.com/repos/trashlab/tenant-${t.id}/branches/main/protection`, {
      required_status_checks: { strict: true, contexts: ["verify"] },
      required_pull_request_reviews: { require_code_owner_reviews: true, required_approving_review_count: 1 },
      enforce_admins: false,
      restrictions: null,
    }, process.env.GITHUB_TOKEN),

  openPr: (t, title, branch) =>
    call("github.openPr", "POST", `https://api.github.com/repos/trashlab/tenant-${t.id}/pulls`, {
      title, head: branch, base: "main",
    }, process.env.GITHUB_TOKEN),
};

export const database = {
  /** Vercel Postgres / Neon. One database per tenant — isolation comes from the
   *  connection string, not from a WHERE clause. */
  provision: (t) =>
    call("database.provision", "POST", `${VERCEL}/v1/storage/stores/postgres${teamQ()}`, {
      name: t.database,
      region: t.region,
    }, process.env.VERCEL_TOKEN),

  migrate: (t) => {
    console.log(`        ${c.cyan("MIGRATE")} ${t.database} ${DRY ? c.dim("(dry-run)") : ""}`);
    return Promise.resolve({ dryRun: DRY });
  },
};
