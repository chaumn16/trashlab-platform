import { defineTenant } from "@trashlab/core/extend";

/**
 * Acme Waste Services — configuration only.
 *
 * No hooks, no custom routes, no custom tables. This is what the majority of
 * tenants look like, and it is the shape the fleet controller can upgrade with
 * zero human involvement: nothing here can conflict with a core release.
 */
export default defineTenant({
  id: "acme",
  displayName: "Acme Waste Services",

  features: {
    invoicing: true,
    routeOptimization: true,
    customerPortal: false,
    weighTickets: true,
  },

  theme: {
    brandColor: "#0f766e",
    logoText: "Acme Waste",
  },

  customFields: {
    customer: [
      { key: "accountRep", label: "Account rep", type: "string" },
      { key: "poRequired", label: "PO required", type: "boolean" },
    ],
  },
});
