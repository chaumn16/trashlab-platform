import tseslint from "typescript-eslint";

/**
 * The import boundary.
 *
 * This is what keeps @trashlab/core's internals from becoming an accidental
 * contract across 2,000 repos. Without it, one agent reaching into core
 * internals turns every core refactor into a fleet-wide breaking change.
 *
 * Public entry points — the only ones with a semver guarantee:
 *   @trashlab/core             CORE_VERSION, createStore
 *   @trashlab/core/extend      business logic: hooks, slots, types, helpers
 *   @trashlab/core/app         the mount: CoreApp, CoreLayout
 *   @trashlab/core/db          the Postgres store + migrate (needs `pg`)
 *   @trashlab/core/conformance the CI test harness
 *
 * Everything else — anything under /dist, /src, or any other subpath — is
 * internal and may change in any minor release.
 *
 * CI runs this before types, tests, or build: a boundary violation is the
 * cheapest failure to diagnose and the most expensive to let through.
 */
export default [
  { ignores: [".next/**", "node_modules/**"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@trashlab/core/*",
                "!@trashlab/core/extend",
                "!@trashlab/core/app",
                "!@trashlab/core/conformance",
                "!@trashlab/core/db",
              ],
              message:
                "That's a core internal, not a public entry point. Tenant code may import " +
                "'@trashlab/core', '/extend', '/app', '/db', or '/conformance' only — everything else " +
                "changes without notice and will break on the next core bump. If you need " +
                "something that isn't exported from one of those, that's a platform request: " +
                "open an issue rather than reaching inside.",
            },
          ],
        },
      ],
    },
  },
];
