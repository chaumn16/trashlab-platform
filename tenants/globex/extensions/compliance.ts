import type { Job, HookContext, ValidationResult, SlotContent, SlotContext } from "@trashlab/core/extend";

/**
 * Globex hauls regulated construction debris and must carry an EPA generator
 * code on every rolloff job. Core has no concept of this and shouldn't.
 */

export function validateJob(job: Job, _ctx: HookContext): ValidationResult {
  if (job.serviceType !== "rolloff") return { ok: true };

  const code = job.custom.epaGeneratorCode;
  if (typeof code !== "string" || !/^[A-Z]{2}\d{9}$/.test(code)) {
    return {
      ok: false,
      errors: [
        {
          field: "custom.epaGeneratorCode",
          message: "Rolloff jobs require a valid EPA generator code (2 letters + 9 digits)",
        },
      ],
    };
  }
  return { ok: true };
}

/** Surfaces the manifest status on the core job detail page, via a core slot. */
export function jobSidebar(ctx: SlotContext): SlotContent | null {
  const job = ctx.job;
  if (!job || job.serviceType !== "rolloff") return null;

  const code = typeof job.custom.epaGeneratorCode === "string" ? job.custom.epaGeneratorCode : null;
  return {
    kind: "rows",
    title: "EPA manifest",
    rows: [
      { label: "Generator code", value: code ?? "⚠ missing" },
      { label: "Manifest", value: code ? "Ready to file" : "Blocked" },
      { label: "Weight source", value: job.weightLbs ? "Certified scale" : "Pending" },
    ],
  };
}

export function dashboardWidget(_ctx: SlotContext): SlotContent {
  return { kind: "stat", label: "Manifests pending", value: "3" };
}
