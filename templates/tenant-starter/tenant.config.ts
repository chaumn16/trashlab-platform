import { defineTenant } from "@trashlab/core/extend";

/**
 * __DISPLAY_NAME__ — tenant configuration.
 *
 * This file and everything under extensions/, app/, migrations/ and tests/ is
 * yours. Core is consumed as a pinned package; you never fork it.
 *
 * Start with `features` and `theme`. Reach for `hooks` only when configuration
 * genuinely cannot express the requirement — every hook you add is code this
 * tenant carries forward across core upgrades.
 */
export default defineTenant({
  id: "__SLUG__",
  displayName: "__DISPLAY_NAME__",

  features: {
    invoicing: true,
    routeOptimization: false,
    customerPortal: false,
    weighTickets: true,
  },

  theme: {
    brandColor: "#1f6feb",
    logoText: "__DISPLAY_NAME__",
  },
});
