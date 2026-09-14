"use server";

import { revalidatePath } from "next/cache";
import { validate, submit, suggestSlug } from "../../../lib/provision";

export interface FormState {
  ok?: boolean;
  /** Distinguishes "the workflow is running" from "we wrote it down". The
   *  success screen must not claim provisioning started when it hasn't. */
  status?: "queued" | "dispatched";
  message?: string;
  errors?: Array<{ field: string; message: string }>;
  values?: { displayName: string; slug: string; plan: string; region: string };
}

/**
 * Server action behind the Add-tenant form.
 *
 * Runs on the server, so no token of any kind is exposed to the browser. The
 * page itself must sit behind SSO in production — it lists and creates
 * customers. See docs/DEPLOY-PLATFORM.md.
 */
export async function createTenant(_prev: FormState, formData: FormData): Promise<FormState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const rawSlug = String(formData.get("slug") ?? "").trim();
  const plan = String(formData.get("plan") ?? "growth");
  const region = String(formData.get("region") ?? "iad1");

  // An empty slug is the common case — sales types a company name and accepts
  // the suggestion.
  const slug = rawSlug || suggestSlug(displayName);
  const values = { displayName, slug, plan, region };

  const errors = await validate({ slug, displayName, plan, region });
  if (errors.length) return { ok: false, errors, values };

  const record = await submit({ ...values, requestedBy: "console" });
  revalidatePath("/");

  if (record.status === "failed") {
    return { ok: false, message: record.detail ?? "Provisioning failed to start.", values };
  }

  return {
    ok: true,
    status: record.status === "dispatched" ? "dispatched" : "queued",
    message:
      record.status === "dispatched"
        ? `It will be live at tenant-${slug}.vercel.app in about four minutes.`
        : record.detail ?? "Recorded, but no provisioning workflow was started.",
  };
}
