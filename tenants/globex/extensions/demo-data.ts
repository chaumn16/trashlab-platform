import { defaultSeed, createStore } from "@trashlab/core";
import type { DataStore } from "@trashlab/core";

/**
 * Stand-in for Globex's own database.
 *
 * In production core connects to DATABASE_URL — a Postgres instance that belongs
 * to Globex alone — and this module does not exist. It is here so the sample app
 * runs with no database while still showing tenant-owned data: the
 * `epaGeneratorCode` custom field lives in Globex's schema and no other tenant
 * has a column for it.
 */
export function globexStore(): DataStore {
  const seed = defaultSeed();

  const jobs = seed.jobs.map((j) =>
    j.serviceType === "rolloff" ? { ...j, custom: { ...j.custom, epaGeneratorCode: "WA482910773" } } : j
  );

  jobs.push(
    {
      id: "job_1006", siteId: "site_3", customerId: "cus_3",
      scheduledFor: "2026-09-17T06:30:00Z", status: "completed",
      serviceType: "rolloff", weightLbs: 11_400, containersServiced: 1,
      custom: { epaGeneratorCode: "WA482910774" },
    },
    {
      id: "job_1007", siteId: "site_3", customerId: "cus_3",
      scheduledFor: "2026-09-18T08:00:00Z", status: "completed",
      serviceType: "rolloff", weightLbs: 3_150, containersServiced: 1,
      custom: {}, // no generator code — validation blocks the manifest
    }
  );

  return createStore({ ...seed, jobs });
}
