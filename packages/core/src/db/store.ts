import type { Customer, Site, Job, JobStatus, ReadOnlyStore } from "../extend/types.js";

/**
 * Data access.
 *
 * ┌─ SWAP POINT ───────────────────────────────────────────────────────────┐
 * │ In production each tenant has its OWN Postgres database (Vercel        │
 * │ Postgres / Neon), so this interface is never tenant-scoped by a WHERE   │
 * │ clause — isolation comes from the connection string, which lives in the │
 * │ tenant's own Vercel project env. Cross-tenant leakage is structurally   │
 * │ impossible rather than a code-review responsibility.                    │
 * │                                                                         │
 * │ Replace createStore() with a Postgres implementation; the interface and │
 * │ every caller stay identical. The in-memory version below is what makes  │
 * │ the sample app runnable with no database.                               │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export interface DataStore extends ReadOnlyStore {
  listCustomers(): Promise<Customer[]>;
  listSites(): Promise<Site[]>;
  getJob(id: string): Promise<Job | null>;
  saveJob(job: Job): Promise<Job>;
}

export function createStore(seed: SeedData = defaultSeed()): DataStore {
  const customers = new Map(seed.customers.map((c) => [c.id, c]));
  const sites = new Map(seed.sites.map((s) => [s.id, s]));
  const jobs = new Map(seed.jobs.map((j) => [j.id, j]));

  return {
    async getCustomer(id) {
      return customers.get(id) ?? null;
    },
    async getSite(id) {
      return sites.get(id) ?? null;
    },
    async listJobs(filter) {
      let out = [...jobs.values()];
      if (filter?.customerId) out = out.filter((j) => j.customerId === filter.customerId);
      if (filter?.status) out = out.filter((j) => j.status === filter.status);
      return out.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    },
    async listCustomers() {
      return [...customers.values()];
    },
    async listSites() {
      return [...sites.values()];
    },
    async getJob(id) {
      return jobs.get(id) ?? null;
    },
    async saveJob(job) {
      jobs.set(job.id, job);
      return job;
    },
  };
}

export interface SeedData {
  customers: Customer[];
  sites: Site[];
  jobs: Job[];
}

/** Demo data. `platform tenant add` seeds a real tenant DB from this shape. */
export function defaultSeed(): SeedData {
  const customers: Customer[] = [
    { id: "cus_1", name: "Harborview Apartments", serviceType: "commercial", custom: {} },
    { id: "cus_2", name: "Mill Street Residences", serviceType: "residential", custom: {} },
    { id: "cus_3", name: "Northgate Construction", serviceType: "rolloff", custom: {} },
    { id: "cus_4", name: "Greenleaf Grocery", serviceType: "recycling", custom: {} },
  ];

  const sites: Site[] = [
    { id: "site_1", customerId: "cus_1", address: "440 Harborview Ave", containers: 4 },
    { id: "site_2", customerId: "cus_2", address: "17 Mill St", containers: 1 },
    { id: "site_3", customerId: "cus_3", address: "9000 Northgate Rd", containers: 2 },
    { id: "site_4", customerId: "cus_4", address: "12 Market Sq", containers: 3 },
  ];

  const jobs: Job[] = [
    {
      id: "job_1001", siteId: "site_1", customerId: "cus_1",
      scheduledFor: "2026-09-15T07:30:00Z", status: "completed",
      serviceType: "commercial", weightLbs: 1840, containersServiced: 4, custom: {},
    },
    {
      id: "job_1002", siteId: "site_2", customerId: "cus_2",
      scheduledFor: "2026-09-15T09:00:00Z", status: "completed",
      serviceType: "residential", weightLbs: 240, containersServiced: 1, custom: {},
    },
    {
      id: "job_1003", siteId: "site_3", customerId: "cus_3",
      scheduledFor: "2026-09-16T06:45:00Z", status: "completed",
      serviceType: "rolloff", weightLbs: 7200, containersServiced: 1, custom: {},
    },
    {
      id: "job_1004", siteId: "site_4", customerId: "cus_4",
      scheduledFor: "2026-09-16T11:15:00Z", status: "en_route",
      serviceType: "recycling", containersServiced: 3, custom: {},
    },
    {
      id: "job_1005", siteId: "site_1", customerId: "cus_1",
      scheduledFor: "2026-09-17T07:30:00Z", status: "scheduled",
      serviceType: "commercial", custom: {},
    },
  ];

  return { customers, sites, jobs };
}
