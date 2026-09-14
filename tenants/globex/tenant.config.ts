import { defineTenant } from "@trashlab/core/extend";
import { price } from "./extensions/pricing.ts";
import { validateJob, jobSidebar, dashboardWidget } from "./extensions/compliance.ts";

/**
 * Globex Industrial — a genuinely customized tenant.
 *
 * Diverges from core in four ways, each at a named extension point:
 *   • weight-bracket pricing instead of the core rate card   (hooks.price)
 *   • mandatory EPA generator code on rolloff jobs           (hooks.validateJob)
 *   • manifest status injected into core's job detail page   (slots)
 *   • a compliance page core knows nothing about             (customRoutes)
 *
 * Core is still a pinned package. None of this is a fork.
 */
export default defineTenant({
  id: "globex",
  displayName: "Globex Industrial",

  features: {
    invoicing: true,
    routeOptimization: true,
    customerPortal: true,
    weighTickets: true,
  },

  theme: {
    brandColor: "#b45309",
    logoText: "Globex Industrial",
  },

  customFields: {
    job: [
      { key: "epaGeneratorCode", label: "EPA generator code", type: "string", required: true },
      { key: "manifestFiledAt", label: "Manifest filed", type: "date" },
    ],
  },

  hooks: {
    price,
    validateJob,
  },

  slots: {
    "job.detail.sidebar": jobSidebar,
    "dashboard.widgets": dashboardWidget,
  },

  customRoutes: [{ path: "/manifests", label: "Manifests", showInNav: true }],
});
